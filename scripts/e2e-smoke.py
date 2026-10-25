#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сквозная проверка платформы «Работа над ошибками» после перехода на своё распознавание.
Идёт полным путём: менеджер создаёт запись, грузит звонок, получает расшифровку, пишет
самоанализ и отправляет; РОП разбирает. Прогон идёт на ДЕМО-компании, живого клиента не трогаем.
"""
import json, sys, time, urllib.request, urllib.error, uuid, mimetypes, os

BASE = os.environ.get("WOE_BASE_URL", "http://localhost:13000/api")
COMPANY = "de300000-0000-4000-a000-000000000001"
MANAGER = "de300000-0000-4000-a000-000000000012"
SPRINT = None  # активный спринт берём у платформы, а не зашиваем: неделя меняется
# Пароль демо-аккаунтов — только из env.
PWD = os.environ.get("RO_E2E_PASSWORD")
if not PWD:
    print("Задайте пароль демо-аккаунтов: export RO_E2E_PASSWORD=...")
    sys.exit(1)

from urllib.parse import urlparse as _urlparse
_h = (_urlparse(BASE).hostname or "")
if _h not in ("localhost", "127.0.0.1", "::1", "backend", "postgres"):
    sys.exit(f"E2E идёт только по локальному контуру: WOE_BASE_URL={BASE!r} — не локальный адрес.")


ok_count = 0
fail_count = 0

def check(name, condition, detail=""):
    global ok_count, fail_count
    if condition:
        ok_count += 1
        print(f"  ✅ {name}")
    else:
        fail_count += 1
        print(f"  ❌ {name} — {detail}")
    return condition

def req(method, path, token=None, body=None, raw=None, ctype=None):
    url = BASE + path
    data = None
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if raw is not None:
        data = raw
        headers["Content-Type"] = ctype
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt[:300]}

def login(email):
    st, d = req("POST", "/auth/login", body={"email": email, "password": PWD})
    if st != 201 and st != 200:
        print(f"  ❌ Логин {email}: HTTP {st} {d}")
        sys.exit(1)
    return d["accessToken"], d.get("user", {})

def upload_audio(token, entry_id, filepath):
    boundary = "----ro" + uuid.uuid4().hex
    fname = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        content = f.read()
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="file"; filename="{fname}"\r\n'.encode()
    body += b"Content-Type: audio/mpeg\r\n\r\n"
    body += content + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return req("POST", f"/entries/{entry_id}/audio", token=token, raw=body,
               ctype=f"multipart/form-data; boundary={boundary}")

def wait_transcription(token, entry_id, timeout=420):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        st, d = req("GET", f"/entries/{entry_id}/audio", token=token)
        last = d
        if d and d.get("status") in ("done", "failed"):
            return d
        time.sleep(10)
    return last

def active_sprint(token):
    """Активный спринт спрашиваем у самой платформы: неделя меняется, зашивать нельзя."""
    st, d = req("GET", f"/sprints/current?companyId={COMPANY}", token=token)
    if st in (200, 201) and isinstance(d, dict) and d.get("id"):
        return d["id"]
    st, d = req("GET", f"/sprints?companyId={COMPANY}", token=token)
    rows = d if isinstance(d, list) else d.get("items", [])
    for s in rows:
        if s.get("status") == "active":
            return s["id"]
    return None

def scenario(title, audio_file, entry_number, expect_speakers):
    global SPRINT
    print(f"\n{'='*70}\n{title}\n{'='*70}")
    tok, user = login("manager1@example.invalid")
    check("Менеджер входит на платформу", bool(tok))
    SPRINT = active_sprint(tok)
    if not check("Активный спринт недели определён", bool(SPRINT)):
        return None

    st, entry = req("POST", "/entries", token=tok, body={
        "sprintId": SPRINT, "managerId": MANAGER, "companyId": COMPANY,
        "type": "call", "entryNumber": entry_number,
        "entryDate": "2026-07-28", "source": "Вручную",
    })
    if not check("Менеджер создаёт запись звонка", st in (200, 201), f"HTTP {st} {entry}"):
        return None
    eid = entry["id"]

    st, up = req("GET", f"/entries/{eid}", token=tok)  # прогрев
    st, up = upload_audio(tok, eid, audio_file)
    if not check("Менеджер загружает запись звонка", st in (200, 201), f"HTTP {st} {up}"):
        return None

    audio = wait_transcription(tok, eid)
    if not check("Расшифровка получена", audio and audio.get("status") == "done",
                 f"статус: {audio.get('status') if audio else 'нет'} / {audio.get('errorMessage') if audio else ''}"):
        return None

    st, fresh = req("GET", f"/entries/{eid}", token=tok)
    text = (fresh.get("transcription") or "")
    check("Текст подставлен в запись автоматически", len(text) > 100, f"длина {len(text)}")

    has_v1 = "Голос 1:" in text
    has_v2 = "Голос 2:" in text
    if expect_speakers:
        check("Реплики разделены на «Голос 1» и «Голос 2»", has_v1 and has_v2,
              f"Голос1={has_v1} Голос2={has_v2}")
    else:
        check("Говорящий не выдуман (нет ложного «Голос 1»)", not has_v1 and not has_v2,
              f"Голос1={has_v1} Голос2={has_v2}")
    check("Нет тире-артефактов в расшифровке", "—" not in text and "–" not in text)
    check("Есть таймкоды реплик", "[0:" in text or "[1:" in text)
    print("  ── начало расшифровки ──")
    for line in [l for l in text.split("\n") if l.strip()][:4]:
        print("   ", line[:110])

    # Самоанализ и отправка
    st, _ = req("PATCH", f"/entries/{eid}", token=tok, body={
        "selfReviewCorrect": "Поздоровался, представился по имени и назвал компанию. Уточнил задачу клиента и зафиксировал договорённость о следующем шаге в конце разговора.",
        "selfReviewImprove": "Не проговорил ценность встречи до предложения цены, поэтому клиент воспринял её как дорогую. Не задал вопрос про сроки, из-за этого не понял срочность и не смог предложить подходящий вариант.",
    })
    check("Самоанализ сохраняется", st in (200, 201), f"HTTP {st}")

    st, sub = req("PATCH", f"/entries/{eid}/submit", token=tok)
    if not check("Менеджер отправляет запись на проверку", st in (200, 201), f"HTTP {st} {sub}"):
        return None
    check("Запись перешла в статус «на проверке»", sub.get("status") == "submitted", sub.get("status"))

    # РОП
    rtok, _ = login("reviewer@example.invalid")
    check("РОП входит на платформу", bool(rtok))
    st, lst = req("GET", f"/entries?sprintId={SPRINT}", token=rtok)
    rows = lst if isinstance(lst, list) else lst.get("items", [])
    check("РОП видит запись в списке на разбор", any(e.get("id") == eid for e in rows))

    st, rev = req("PATCH", f"/entries/{eid}/review", token=rtok, body={
        "reviewText": "Хороший звонок по структуре: приветствие, выявление задачи, фиксация следующего шага. Усилить одно: ценность встречи проговаривай до цены, тогда сумма перестаёт быть первым, что слышит клиент. И спрашивай про сроки в начале, это меняет выбор варианта."
    })
    if not check("РОП сохраняет разбор", st in (200, 201), f"HTTP {st} {rev}"):
        return None
    check("Запись перешла в статус «проверено»", rev.get("status") == "reviewed", rev.get("status"))
    return eid

if __name__ == "__main__":
    sp = os.path.dirname(os.path.abspath(__file__))
    scenario("СЦЕНАРИЙ 1. Стереозапись: собеседники разведены по каналам",
             os.path.join(sp, "test-stereo.mp3"), 11, expect_speakers=True)
    scenario("СЦЕНАРИЙ 2. Обычная моно-запись",
             os.path.join(sp, "zvonok-nikita.mp3"), 12, expect_speakers=False)
    scenario("СЦЕНАРИЙ 3. Задублированное стерео (защита от удвоения текста)",
             os.path.join(sp, "test-dualmono.mp3"), 13, expect_speakers=False)

    print(f"\n{'='*70}\nИТОГ: успешно {ok_count}, провалено {fail_count}\n{'='*70}")
    sys.exit(1 if fail_count else 0)
