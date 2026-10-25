#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальный smoke полного рабочего цикла: менеджер создаёт ТЕКСТОВУЮ запись, пишет
самоанализ, отправляет; руководитель разбирает; менеджер подтверждает «Прочитал»,
руководитель дополняет разбор — появляется новая отметка. Плюс скрытие/возврат
первых шагов. Без STT/LLM/CRM — только демо-данные.
"""
import json, sys, os, urllib.request, urllib.error

BASE = os.environ.get("WOE_BASE_URL", "http://localhost:13000/api")
from urllib.parse import urlparse
if (urlparse(BASE).hostname or "") not in ("localhost", "127.0.0.1", "::1", "backend"):
    sys.exit(f"Smoke идёт только по локальному контуру: WOE_BASE_URL={BASE!r} — не локальный адрес.")

PWD = os.environ.get("RO_E2E_PASSWORD")
if not PWD:
    sys.exit("Задайте пароль демо-аккаунтов: export RO_E2E_PASSWORD=...")

ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  ✅ {name}")
    else: fail += 1; print(f"  ❌ {name} — {detail}")
    return cond

def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

def login(email):
    st, d = req("POST", "/auth/login", body={"email": email, "password": PWD})
    return (d.get("accessToken") if st in (200, 201) and isinstance(d, dict) else None), (d.get("user") if isinstance(d, dict) else None) or st

print("== вход ==")
mtok, muser = login("manager1@example.invalid"); check("manager1 входит", bool(mtok), muser)
rtok, ruser = login("reviewer@example.invalid"); check("reviewer входит", bool(rtok), ruser)
if not (mtok and rtok): sys.exit(1)

me = muser if isinstance(muser, dict) else {}
company_id = me.get("companyId") or me.get("company", {}).get("id")
check("companyId у менеджера", bool(company_id), me)
mgr_id = me.get("id")

st, cur = req("GET", f"/sprints/current?companyId={company_id}", token=mtok)
sprint_id = (cur or {}).get("id") if isinstance(cur, dict) else None
check("активный спринт", bool(sprint_id), cur)
if not sprint_id:
    st, lst = req("GET", f"/sprints?companyId={company_id}", token=mtok)
    lst = lst if isinstance(lst, list) else lst.get("items", [])
    sprint_id = lst[0]["id"] if lst else None
    check("любой спринт", bool(sprint_id), st)

print("== запись: создание → самоанализ → отправка ==")
import time
num = int(time.time() % 100000) + 900000
ebody = {"sprintId": sprint_id, "managerId": mgr_id, "companyId": company_id,
         "type": "chat", "entryNumber": num, "entryDate": "2026-10-25",
         "source": "smoke",
         "transcription": "Менеджер: Здравствуйте, чем помочь?\nКлиент: Интересует стоимость работ.\nМенеджер: Назову после уточнения объёма — скажите марку и год."}
st, ent = req("POST", "/entries", token=mtok, body=ebody)
eid = ent.get("id") if isinstance(ent, dict) else None
check("запись создана (текст)", st in (200, 201) and bool(eid), f"{st} {str(ent)[:160]}")

st, _ = req("PATCH", f"/entries/{eid}", token=mtok, body={
    "selfReviewCorrect": "Уточнил марку и год автомобиля перед озвучиванием стоимости — не назвал цену вслепую и сохранил доверие клиента. Поздоровался и держал нейтральный тон.",
    "selfReviewImprove": "Не предложил следующий конкретный шаг: ни время записи, ни способ связи для точного расчёта. Клиент ушёл без понятного продолжения диалога и без зафиксированной договорённости — такой разговор легко теряется.",
    "selfReviewSuggestions": "В конце разговора предлагать слот времени: «Могу записать вас на среду в 11 или четверг в 14 — что удобнее?» и фиксировать контакт для подтверждения."})
check("самоанализ принят", st in (200, 201, 204), st)

st, _ = req("PATCH", f"/entries/{eid}/submit", token=mtok)
check("отправлено на проверку", st in (200, 201, 204), st)

print("== разбор руководителя ==")
REVIEW1 = "Верно подмечено уточнение марки и года перед ценой — это сильная сторона разговора. Следующий шаг: в конце диалога всегда предлагать конкретное время записи и фиксировать контакт для подтверждения."
st, _ = req("PATCH", f"/entries/{eid}/review", token=rtok, body={"reviewText": REVIEW1})
check("ревью поставлено", st in (200, 201, 204), st)

print("== прочитал → правка разбора → новая отметка ==")
st, ent2 = req("GET", f"/entries/{eid}", token=mtok)
h1 = ent2.get("reviewTextHash") if isinstance(ent2, dict) else None
check("reviewTextHash известен", bool(h1), list(ent2.keys())[:15] if isinstance(ent2, dict) else st)
st, _ = req("PATCH", f"/entries/{eid}/review-confirm", token=mtok, body={"expectedHash": h1})
check("менеджер отметил «Прочитал»", st in (200, 201, 204), st)

REVIEW2 = REVIEW1 + " Дополнение: договорённость дублируйте в чат клиенту текстом."
st, _ = req("PATCH", f"/entries/{eid}/review", token=rtok, body={"reviewText": REVIEW2})
check("руководитель дополнил разбор", st in (200, 201, 204), st)

st, ent3 = req("GET", f"/entries/{eid}", token=mtok)
h2 = ent3.get("reviewTextHash") if isinstance(ent3, dict) else None
conf = ent3.get("reviewConfirmedHash") if isinstance(ent3, dict) else None
reread = ent3.get("reviewRereadAt") if isinstance(ent3, dict) else None
check("после правки требуется новая отметка (hash ≠ confirmed)", st == 200 and h2 and h2 != conf,
      f"hash={bool(h2)} confirmed={bool(conf)} reread={reread}")
st, _ = req("PATCH", f"/entries/{eid}/review-confirm", token=mtok, body={"expectedHash": h2})
check("вторая отметка «Прочитал» принята", st in (200, 201, 204), st)

print("== первые шаги ==")
st, _ = req("POST", "/users/me/first-steps-hidden", token=mtok, body={"hidden": True})
check("первые шаги скрыты", st in (200, 201), st)
st, me2 = req("GET", f"/users/{mgr_id}", token=mtok)
hidden = me2.get("firstStepsHiddenAt") if isinstance(me2, dict) else None
check("состояние скрыто у пользователя", st == 200 and bool(hidden), st)
st, _ = req("POST", "/users/me/first-steps-hidden", token=mtok, body={"hidden": False})
check("первые шаги возвращены", st in (200, 201), st)
st, me3 = req("GET", f"/users/{mgr_id}", token=mtok)
check("состояние возвращено", st == 200 and not me3.get("firstStepsHiddenAt"), me3.get("firstStepsHiddenAt"))

print(f"\nИтого: {ok} ок, {fail} провал")
sys.exit(1 if fail else 0)
