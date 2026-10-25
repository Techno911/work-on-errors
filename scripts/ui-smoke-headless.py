#!/usr/bin/env python3
"""
Headless UI-контроль локального кандидата (только localhost): реальная форма
входа менеджером, открытие записи с разбором на доске спринта, отметка
«Прочитал» в ReviewConfirmBlock, скрытие/возврат подсказки первых шагов.
Проверяемый объект подготавливается через API, все действия — только UI.
"""
import os, sys, json, urllib.request, urllib.error, time
from urllib.parse import urlparse

API = os.environ.get("WOE_API_URL", "http://localhost:13000/api")
BASE = os.environ.get("WOE_UI_URL", "http://localhost:15173")
for url in (API, BASE):
    if (urlparse(url).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
        sys.exit(f"Только локальный адрес: {url!r}")
PWD = os.environ.get("RO_UI_PASSWORD")
if not PWD:
    sys.exit("Задайте пароль демо-аккаунта: export RO_UI_PASSWORD=...")

def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(API + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def login(email):
    st, d = req("POST", "/auth/login", body={"email": email, "password": PWD})
    return d.get("accessToken"), (d.get("user") or {})

ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  ✅ {name}")
    else: fail += 1; print(f"  ❌ {name} — {detail}")
    return cond

print("== подготовка объекта (API): разобранная запись без отметки ==")
mtok, me = login("manager1@example.invalid")
rtok, _ = login("reviewer@example.invalid")
cid, mid = me["companyId"], me["id"]
st, cur = req("GET", f"/sprints/current?companyId={cid}", token=mtok)
sid = cur.get("id")
num = int(time.time() % 100000) + 900000
LONG = "Развёрнутый комментарий для проверки минимальной длины обратной связи. "
st, ent = req("POST", "/entries", token=mtok, body={
    "sprintId": sid, "managerId": mid, "companyId": cid, "type": "chat",
    "entryNumber": num, "entryDate": "2026-10-25", "source": "ui-smoke",
    "transcription": "Менеджер: Здравствуйте!\nКлиент: Сколько стоит работа?\nМенеджер: Уточню объём и назову цену."})
eid = ent.get("id")
req("PATCH", f"/entries/{eid}", token=mtok, body={
    "selfReviewCorrect": LONG * 2,
    "selfReviewImprove": LONG * 3,
    "selfReviewSuggestions": LONG * 2})
st, _ = req("PATCH", f"/entries/{eid}/submit", token=mtok)
check("запись отправлена", st in (200, 201, 204), st)
st, _ = req("PATCH", f"/entries/{eid}/review", token=rtok,
            body={"reviewText": LONG * 3 + "Конкретика по записи клиента."})
check("разбор поставлен", st in (200, 201, 204), st)

from playwright.sync_api import sync_playwright
SHOT_DIR = os.environ.get("SHOT_DIR", ".")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(locale="ru-RU")
    page = ctx.new_page()

    print("== вход реальной формой ==")
    page.goto(BASE + "/login", wait_until="domcontentloaded")
    page.fill('input[type="email"]', "manager1@example.invalid")
    page.fill('input[type="password"]', PWD)
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle")
    # Первый вход: согласия (ПДн, локальный акт) до рабочих страниц
    for _ in range(3):
        if "consent" in page.url or page.locator('button:has-text("Подтвердить")').count():
            for cb in page.locator('input[type="checkbox"]').all():
                if not cb.is_checked(): cb.check(force=True)
            page.wait_for_timeout(400)
            b = page.locator('button:has-text("Подтвердить")').first
            if not b.count() or not b.is_enabled(): break
            b.click(); page.wait_for_load_state("networkidle")
        else: break
    check("менеджер вошёл", "/login" not in page.url and "consent" not in page.url, page.url)
    page.screenshot(path=os.path.join(SHOT_DIR, "ui-01-after-login.png"))

    print("== отметка «Прочитал» ==")
    page.goto(BASE + "/sprint", wait_until="networkidle")
    page.wait_for_timeout(1000)
    # Свежая карточка ui-smoke на доске — раскрываем кликом, внутри ReviewConfirmBlock
    card = page.locator('button', has_text="ui-smoke").last
    check("карточка записи на доске", card.count() > 0, "нет карточки")
    if card.count():
        card.click()
        page.wait_for_timeout(1000)
    btn = page.locator('button:has-text("Прочитал")').first
    check("кнопка «Прочитал» видна", btn.count() > 0 and btn.is_visible())
    if btn.count() and btn.is_visible():
        btn.click()
        page.wait_for_timeout(1500)
        gone = page.locator('button:has-text("Прочитал")').count() == 0 or \
               page.locator('text=Последнее подтверждение').first.is_visible()
        check("отметка принята UI", gone)
    page.screenshot(path=os.path.join(SHOT_DIR, "ui-02-confirm.png"))

    print("== подсказка первых шагов (свежий пользователь) ==")
    page.goto(BASE + "/login", wait_until="domcontentloaded")
    page.fill('input[type="email"]', os.environ.get("RO_UI_FRESH_EMAIL", "freshui@example.invalid"))
    page.fill('input[type="password"]', PWD)
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle")
    for _ in range(3):
        if "consent" in page.url or page.locator('button:has-text("Подтвердить")').count():
            for cb in page.locator('input[type="checkbox"]').all():
                if not cb.is_checked(): cb.check(force=True)
            page.wait_for_timeout(400)
            b = page.locator('button:has-text("Подтвердить")').first
            if not b.count() or not b.is_enabled(): break
            b.click(); page.wait_for_load_state("networkidle")
        else: break
    check("свежий пользователь вошёл", "consent" not in page.url and "/login" not in page.url, page.url)
    page.goto(BASE + "/dashboard", wait_until="networkidle")
    page.wait_for_timeout(800)
    # Модалки (карточка записи, «Что нового») закрываем до дашборда
    for _ in range(3):
        if page.locator('.chip-modal__backdrop').count() == 0: break
        close = page.locator('.chip-modal button:has-text("✕"), .chip-modal button:has-text("Закрыть"), .chip-modal [aria-label="Закрыть"]').first
        if close.count() and close.is_visible(): close.click()
        else: page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    hide = page.locator('button:has-text("Скрыть подсказку")').first
    check("кнопка скрытия подсказки видна", hide.count() > 0 and hide.is_visible())
    if hide.count() and hide.is_visible():
        hide.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        check("подсказка скрыта на главной", page.locator('button:has-text("Скрыть подсказку")').count() == 0)
        page.goto(BASE + "/manual", wait_until="networkidle")
        back = page.locator('button:has-text("Показать на главной")').first
        check("кнопка возврата подсказки есть", back.count() > 0 and back.is_visible())
        if back.count() and back.is_visible():
            back.click(); page.wait_for_timeout(1000)
            page.goto(BASE + "/dashboard", wait_until="networkidle")
            check("подсказка вернулась на главную", page.locator('button:has-text("Скрыть подсказку")').count() > 0)
    page.screenshot(path=os.path.join(SHOT_DIR, "ui-03-first-steps.png"))
    browser.close()

print(f"\nИтого: {ok} ок, {fail} провал")
sys.exit(1 if fail else 0)
