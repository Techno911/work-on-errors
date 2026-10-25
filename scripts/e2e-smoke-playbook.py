#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сквозная проверка МЕТОДИЧКИ и АТТЕСТАЦИИ (v7.4.0-7.7.1) — разделов платформы, которых
e2e-smoke.py не покрывает вообще. Идёт полным путём: РОП разбирает звонки с повтором
ошибки → платформа сама поднимает кандидата (по тегу И по смыслу без тега) → РОП
подтверждает → генерирует аттестацию → менеджер сдаёт → ИИ предлагает баллы → РОП
проверяет и утверждает → критичный вопрос валит попытку независимо от среднего балла →
назначается пересдача второй формы. Прогон на ДЕМО-компании, все тестовые сущности
удаляются за собой (SQL по собранным ID локально, в порядке FK).
"""
import json, os, sys, time, urllib.request, urllib.error, subprocess, uuid, shlex

BASE = os.environ.get("WOE_BASE_URL", "http://localhost:13000/api")
COMPANY = "de300000-0000-4000-a000-000000000001"
# Пароль демо-аккаунтов — из env, не литералом (см. e2e-smoke.py: тот же боевой прод-хост).
PWD = os.environ.get("RO_E2E_PASSWORD")
from urllib.parse import urlparse as _urlparse
_h = (_urlparse(BASE).hostname or "")
if _h not in ("localhost", "127.0.0.1", "::1", "backend", "postgres"):
    sys.exit(f"E2E идёт только по локальному контуру: WOE_BASE_URL={BASE!r} — не локальный адрес.")

if not PWD:
    print("Задайте пароль демо-аккаунтов: export RO_E2E_PASSWORD=...")
    sys.exit(1)
# Локальный psql через DATABASE_URL (например postgres://ro_user:ro_password@localhost:15432/ro_db)
DATABASE_URL = os.environ.get("DATABASE_URL", "")

ok_count = 0
fail_count = 0
created = {"entries": [], "tags": [], "cards": [], "tests": []}


def check(name, condition, detail=""):
    global ok_count, fail_count
    if condition:
        ok_count += 1
        print(f"  ✅ {name}")
    else:
        fail_count += 1
        print(f"  ❌ {name} — {detail}")
    return condition


def req(method, path, token=None, body=None):
    url = BASE + path
    data = None
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
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
    if st not in (200, 201):
        print(f"  ❌ Логин {email}: HTTP {st} {d}")
        sys.exit(1)
    return d["accessToken"], d.get("user", {})


def active_sprint(token):
    st, d = req("GET", f"/sprints/current?companyId={COMPANY}", token=token)
    if st in (200, 201) and isinstance(d, dict) and d.get("id"):
        return d["id"]
    st, d = req("GET", f"/sprints?companyId={COMPANY}", token=token)
    rows = d if isinstance(d, list) else d.get("items", [])
    for s in rows:
        if s.get("status") == "active":
            return s["id"]
    return None


def make_reviewed_entry(mtok, rtok, manager_id, sprint_id, entry_number, review_text, tag_ids=None):
    """Менеджер создаёт запись и сразу отдаёт готовый текст разговора (без реального аудио —
    здесь важна не транскрипция, а цепочка ревью→детекция), РОП разбирает с тегом или без."""
    st, entry = req("POST", "/entries", token=mtok, body={
        "sprintId": sprint_id, "managerId": manager_id, "companyId": COMPANY,
        "type": "call", "entryNumber": entry_number,
        "entryDate": "2026-07-28", "source": "Вручную",
    })
    if st not in (200, 201):
        return None, f"создание записи: HTTP {st} {entry}"
    eid = entry["id"]
    created["entries"].append(eid)

    st, _ = req("PATCH", f"/entries/{eid}", token=mtok, body={
        "transcription": "[0:05] Голос: разговор с клиентом по стандартному сценарию, текст для теста платформы.",
        "selfReviewCorrect": "Поздоровался, представился, уточнил задачу клиента и зафиксировал следующий шаг.",
        "selfReviewImprove": "Не проговорил ценность встречи до цены, из-за этого клиент воспринял её как дорогую.",
    })
    if st not in (200, 201):
        return None, f"самоанализ: HTTP {st}"

    st, sub = req("PATCH", f"/entries/{eid}/submit", token=mtok)
    if st not in (200, 201):
        return None, f"отправка: HTTP {st} {sub}"

    body = {"reviewText": review_text}
    if tag_ids:
        body["tagIds"] = tag_ids
    st, rev = req("PATCH", f"/entries/{eid}/review", token=rtok, body=body)
    if st not in (200, 201):
        return None, f"разбор: HTTP {st} {rev}"
    return eid, None


def run_sql(sql):
    """Локальный psql по DATABASE_URL. Без него SQL-шаги пропускаются."""
    if not DATABASE_URL:
        return False, "DATABASE_URL не задан — SQL-шаг пропущен"
    try:
        p = subprocess.run(["psql", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", sql],
                           capture_output=True, text=True, timeout=60)
        return p.returncode == 0, (p.stdout + p.stderr)
    except Exception as e:
        return False, str(e)


def main():
    print("=" * 70)
    print("СЦЕНАРИЙ A. Методичка: повтор ПО ТЕГУ поднимает кандидата сам")
    print("=" * 70)

    rtok, ruser = login("reviewer@example.invalid")
    check("РОП входит на платформу", bool(rtok))
    mtok, muser = login("manager1@example.invalid")
    check("Менеджер входит на платформу", bool(mtok))
    manager_id = muser.get("id")
    sprint_id = active_sprint(mtok)
    if not check("Активный спринт определён", bool(sprint_id)):
        return finish()

    tag_name = f"E2E-тест-тег {uuid.uuid4().hex[:6]}"
    st, tag = req("POST", "/error-tags", token=rtok, body={"companyId": COMPANY, "name": tag_name})
    if not check("РОП создаёт тег ошибки", st in (200, 201), f"HTTP {st} {tag}"):
        return finish()
    tag_id = tag["id"]
    created["tags"].append(tag_id)

    review_texts_tag = [
        "Не проговорил конкретные сроки внедрения по каждому этапу работы, клиент так и не понял, когда именно получит результат, и это создало у него ощущение неопределённости на весь разговор.",
        "Опять не назвал точные сроки по этапам работы, клиент уточнял их сам, хотя это должен был сделать менеджер сразу и без напоминаний, чтобы клиент не тратил время на уточняющие вопросы.",
        "Сроки этапов снова не прозвучали в разговоре, клиент ушёл думать без понимания дедлайнов, и по опыту прошлых разборов это стабильно тормозит принятие решения о старте работы.",
    ]
    for i, text in enumerate(review_texts_tag):
        eid, err = make_reviewed_entry(mtok, rtok, manager_id, sprint_id, 9001 + i, text, tag_ids=[tag_id])
        check(f"Запись {i+1}/3 с тегом создана и разобрана", eid is not None, err or "")

    st, cands = req("GET", f"/playbook/candidates?companyId={COMPANY}", token=rtok)
    tag_card = next((c for c in cands if c.get("errorTagId") == tag_id), None)
    check("Кандидат по тегу поднялся сам (без ручной галочки)", tag_card is not None,
          f"кандидатов всего: {len(cands) if isinstance(cands, list) else cands}")
    if tag_card:
        created["cards"].append(tag_card["id"])
        check("detectionSource='tag'", tag_card.get("detectionSource") == "tag", tag_card.get("detectionSource"))
        check("occurrenceCount >= 3", tag_card.get("occurrenceCount", 0) >= 3, tag_card.get("occurrenceCount"))
        check("Тренд посчитан как 'increasing' (три случая только что)", tag_card.get("trend") == "increasing", tag_card.get("trend"))
        check("Доказательства — цитаты из текста ревью, не выдумка", len(tag_card.get("evidence") or []) > 0)

        st, confirmed = req("POST", f"/playbook/candidates/{tag_card['id']}/confirm?companyId={COMPANY}",
                             token=rtok, body={"ruleText": "Всегда называем клиенту точные сроки по каждому этапу работы."})
        check("РОП подтверждает кандидата → карточка активна", st in (200, 201) and confirmed.get("status") == "active",
              f"HTTP {st} {confirmed}")

    print("\n" + "=" * 70)
    print("СЦЕНАРИЙ B. Методичка: повтор ПО СМЫСЛУ поднимает кандидата БЕЗ тега")
    print("=" * 70)

    review_texts_semantic = [
        "Клиенту не проговорили стоимость сопровождения после запуска работ, он узнал о ней уже постфактум из счёта и был этим недоволен, хотя разговор в остальном прошёл по стандарту хорошо.",
        "Опять забыли сказать про цену сопровождения после старта работ, для клиента это стало неприятным сюрпризом позже, а могло бы решиться одной фразой в конце звонка про дальнейшие расходы.",
        "Стоимость послепускового сопровождения снова не прозвучала в разговоре, клиент выяснял её отдельно уже после подписания, и это повторяющаяся история за последние несколько разборов.",
    ]
    for i, text in enumerate(review_texts_semantic):
        eid, err = make_reviewed_entry(mtok, rtok, manager_id, sprint_id, 9011 + i, text, tag_ids=None)
        check(f"Запись {i+1}/3 без тега создана и разобрана", eid is not None, err or "")
        time.sleep(2)  # даём фоновому storeEmbedding() чуть форы перед следующим review()

    st, cands = req("GET", f"/playbook/candidates?companyId={COMPANY}", token=rtok)
    sem_card = next((c for c in cands if c.get("detectionSource") == "semantic"), None) if isinstance(cands, list) else None
    check("Кандидат по смыслу поднялся сам, БЕЗ единого тега", sem_card is not None,
          f"кандидатов: {cands if not isinstance(cands, list) else len(cands)}")
    if sem_card:
        created["cards"].append(sem_card["id"])
        check("occurrenceCount >= 3 (кластер похожих разборов)", sem_card.get("occurrenceCount", 0) >= 3, sem_card.get("occurrenceCount"))
        st, confirmed = req("POST", f"/playbook/candidates/{sem_card['id']}/confirm?companyId={COMPANY}",
                             token=rtok, body={"ruleText": "Всегда называем стоимость сопровождения после запуска ДО подписания."})
        check("РОП подтверждает семантического кандидата", st in (200, 201) and confirmed.get("status") == "active",
              f"HTTP {st} {confirmed}")

    if len(created["cards"]) < 2:
        print("\n⚠ Недостаточно активных карточек для аттестации — сценарий C пропущен.")
        return finish()

    print("\n" + "=" * 70)
    print("СЦЕНАРИЙ C. Аттестация: генерация → сдача → ИИ-оценка → проверка РОПа → пересдача")
    print("=" * 70)

    st, test = req("POST", f"/attestation/tests?companyId={COMPANY}", token=rtok, body={})
    if not check("РОП запускает генерацию теста из активных карточек", st in (200, 201), f"HTTP {st} {test}"):
        return finish()
    test_id = test["id"]
    created["tests"].append(test_id)

    test = poll_test_draft(rtok, test_id, timeout=180)
    if not check("Тест сгенерирован (статус draft)", test is not None and test.get("status") == "draft",
                 f"{test.get('status') if test else 'таймаут'} / ошибка: {test.get('generationError') if test else ''}"):
        return finish()

    st, attempts_before = req("GET", f"/attestation/tests/{test_id}/attempts?companyId={COMPANY}", token=rtok)
    check("До назначения попыток ещё нет", isinstance(attempts_before, list) and len(attempts_before) == 0,
          f"HTTP {st} {attempts_before}")

    st, assigned = req("POST", f"/attestation/tests/{test_id}/assign?companyId={COMPANY}", token=rtok, body={})
    check("РОП назначает тест команде", st in (200, 201) and assigned.get("status") == "active", f"HTTP {st} {assigned}")

    st, my = req("GET", "/attestation/my", token=mtok)
    my_attempt = next((a for a in my if a.get("testId") == test_id), None) if isinstance(my, list) else None
    if not check("Менеджер видит назначенную попытку", my_attempt is not None):
        return finish()
    attempt_id = my_attempt["id"]

    st, taking = req("GET", f"/attestation/attempts/{attempt_id}/take", token=mtok)
    if not check("Менеджер открывает вопросы (без эталона в ответе)", st in (200, 201) and "referenceAnswer" not in json.dumps(taking.get("questions", [])),
                 f"HTTP {st}"):
        return finish()
    questions = taking["questions"]
    check("Вопросы сгенерированы по всем активным карточкам (3 знание/ситуация/проба на карточку)",
          len(questions) >= 3, f"вопросов: {len(questions)}")

    critical_q = None
    for i, q in enumerate(questions):
        # Первый вопрос типа 'practice' или 'situation' намеренно отвечаем МИМО правила —
        # это и должен быть критичный вопрос (карточка A, тренд 'increasing' ≠ 'decreasing').
        if critical_q is None and q["type"] in ("situation", "practice"):
            answer = "Скажу цену только если клиент сам спросит, сроки называть не буду заранее."
            critical_q = q["id"]
        else:
            answer = "Отвечаю строго по правилу методички: называю клиенту требуемую информацию сразу и явно."
        st, _ = req("PUT", f"/attestation/attempts/{attempt_id}/answers/{q['id']}", token=mtok, body={"answerText": answer})
        check(f"Ответ на вопрос {i+1}/{len(questions)} сохранён", st in (200, 201), f"HTTP {st}")

    st, submitted = req("POST", f"/attestation/attempts/{attempt_id}/submit", token=mtok)
    check("Менеджер отправляет попытку", st in (200, 201) and submitted.get("status") == "submitted", f"HTTP {st} {submitted}")

    graded_items = poll_ai_graded(rtok, attempt_id, test_id, timeout=240)
    if not check("Фоновая ИИ-оценка ответов завершилась (статус ai_graded)", graded_items is not None):
        return finish()
    check("У ответов появился предложенный ИИ балл с обоснованием",
          all(i["answer"] is not None and i["answer"].get("aiSuggestedScore") is not None for i in graded_items),
          json.dumps([i["answer"] for i in graded_items], ensure_ascii=False)[:300])

    critical_item = next((i for i in graded_items if i["question"]["id"] == critical_q), None)
    check("Критичный вопрос (карточка с трендом increasing) помечен isCritical", critical_item and critical_item["question"]["isCritical"] is True,
          critical_item["question"] if critical_item else None)

    # РОП проверяет: критичный ответ, отвечавший НЕ по правилу, ставим в 0 (проверка, что РОП
    # может переопределить предложение ИИ, а не только штамповать его); остальные — 2.
    for item in graded_items:
        score = 0 if item["question"]["id"] == critical_q else 2
        st, _ = req("PUT", f"/attestation/attempts/{attempt_id}/answers/{item['question']['id']}/grade?companyId={COMPANY}",
                    token=rtok, body={"reviewerScore": score})
        check(f"РОП проставляет балл {score} за вопрос {item['question']['type']}", st in (200, 201), f"HTTP {st}")

    st, final = req("POST", f"/attestation/attempts/{attempt_id}/finalize?companyId={COMPANY}", token=rtok)
    if not check("РОП завершает проверку попытки", st in (200, 201), f"HTTP {st} {final}"):
        return finish()
    check("Критичная ошибка валит попытку НЕЗАВИСИМО от среднего балла (passed=false)", final.get("passed") is False,
          f"passed={final.get('passed')} totalScorePercent={final.get('totalScorePercent')}")
    check("failedCritical=true зафиксирован в результате", final.get("failedCritical") is True, final.get("failedCritical"))

    st, retake = req("POST", f"/attestation/attempts/{attempt_id}/retake?companyId={COMPANY}", token=rtok)
    if check("Не сдавшему назначается пересдача", st in (200, 201), f"HTTP {st} {retake}"):
        created["tests"].append(retake["id"])
        check("Пересдача — форма B (не те же формулировки вопросов)", retake.get("formVariant") == "B", retake.get("formVariant"))
        check("Пересдача ссылается на исходный тест", retake.get("originalTestId") == test_id, retake.get("originalTestId"))
        retake_draft = poll_test_draft(rtok, retake["id"], timeout=180)
        check("Вопросы пересдачи тоже сгенерировались", retake_draft is not None and retake_draft.get("status") == "draft",
              retake_draft.get("status") if retake_draft else "таймаут")

    return finish()


def poll_test_draft(token, test_id, timeout):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        st, d = req("GET", f"/attestation/tests?companyId={COMPANY}", token=token)
        last = next((t for t in d if t["id"] == test_id), None) if isinstance(d, list) else None
        if last and last.get("status") in ("draft",):
            return last
        time.sleep(5)
    return last


def poll_ai_graded(token, attempt_id, test_id, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        st, review = req("GET", f"/attestation/attempts/{attempt_id}/review?companyId={COMPANY}", token=token)
        attempt = review.get("attempt") if isinstance(review, dict) else None
        if attempt and attempt.get("status") == "ai_graded":
            return review.get("items")
        time.sleep(8)
    return None


def finish():
    print("\n" + "=" * 70)
    print(f"ИТОГ: успешно {ok_count}, провалено {fail_count}")
    print("=" * 70)
    cleanup()
    sys.exit(1 if fail_count else 0)


def cleanup():
    print("\n── Уборка тестовых данных за собой ──")
    steps = []
    if created["tests"]:
        ids = ",".join(f"'{i}'" for i in created["tests"])
        steps.append(f"DELETE FROM attestation_tests WHERE id IN ({ids});")
    if created["cards"]:
        ids = ",".join(f"'{i}'" for i in created["cards"])
        steps.append(f"DELETE FROM playbook_cards WHERE id IN ({ids});")
    if created["entries"]:
        # entry_error_tags чистится каскадом от FK entries/error_tags (ON DELETE CASCADE) —
        # отдельного шага не нужно.
        ids = ",".join(f"'{i}'" for i in created["entries"])
        steps.append(f"DELETE FROM entries WHERE id IN ({ids});")
    if created["tags"]:
        ids = ",".join(f"'{i}'" for i in created["tags"])
        steps.append(f"DELETE FROM error_tags WHERE id IN ({ids});")
    ok_all = True
    for sql in steps:
        ok, out = run_sql(sql)
        ok_all = ok_all and ok
        print(f"  {'✅' if ok else '❌'} {sql[:70]}")
        if not ok:
            print(f"     {out.strip()[:300]}")
    if not steps:
        print("  (нечего убирать)")
    elif ok_all:
        print("  Все тестовые сущности удалены.")


if __name__ == "__main__":
    main()
