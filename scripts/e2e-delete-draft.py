#!/usr/bin/env python3
"""Прод-проверка: РОП удаляет только черновик менеджера в демо-компании."""

import json
import os
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request


BASE = os.environ.get("WOE_BASE_URL", "http://localhost:13000/api")
COMPANY_ID = os.environ.get("WOE_COMPANY_ID", "")
if not COMPANY_ID:
    sys.exit("Задайте WOE_COMPANY_ID — id локальной демо-компании")
MANAGER_PASSWORD = os.environ.get("RO_E2E_MANAGER_PASSWORD")
REVIEWER_PASSWORD = os.environ.get("RO_E2E_REVIEWER_PASSWORD")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

from urllib.parse import urlparse as _urlparse
_h = (_urlparse(BASE).hostname or "")
if _h not in ("localhost", "127.0.0.1", "::1", "backend"):
    sys.exit(f"Скрипт идёт только по локальному контуру: WOE_BASE_URL={BASE!r} — не локальный адрес.")
if DATABASE_URL:
    _dh = (_urlparse(DATABASE_URL).hostname or "")
    if _dh not in ("localhost", "127.0.0.1", "::1", "postgres"):
        sys.exit("DATABASE_URL должен указывать на локальную базу (localhost/127.0.0.1/postgres).")
def run_sql(sql):
    if not DATABASE_URL:
        print("DATABASE_URL не задан — SQL-шаг пропущен")
        return None
    return subprocess.run(["psql", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", sql],
                          capture_output=True, text=True, timeout=60)


def request(method: str, path: str, token: str | None = None, body: dict | None = None):
    headers = {}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read().decode()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw[:200]}
        return error.code, payload


def login(email: str, password: str):
    status, payload = request("POST", "/auth/login", body={"email": email, "password": password})
    if status not in (200, 201):
        raise RuntimeError(f"Не удалось войти под {email}: HTTP {status}")
    return payload["accessToken"], payload["user"]


def check(label: str, condition: bool, detail: str = ""):
    marker = "✅" if condition else "❌"
    print(f"{marker} {label}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        raise AssertionError(label)


def cleanup(entry_id: str | None):
    if not entry_id:
        return
    sql = f"DELETE FROM entries WHERE id = '{entry_id}';"
    remote = f"{PSQL} -c {shlex.quote(sql)}"
    result = run_sql(remote)
    if result.returncode != 0:
        print("⚠ Не удалось убрать тестовую запись; проверьте демо-компанию вручную")


def main():
    if not MANAGER_PASSWORD or not REVIEWER_PASSWORD:
        print("Задайте RO_E2E_MANAGER_PASSWORD и RO_E2E_REVIEWER_PASSWORD")
        return 2

    created_id = None
    try:
        manager_token, manager = login("manager1@example.invalid", MANAGER_PASSWORD)
        reviewer_token, _ = login("reviewer@example.invalid", REVIEWER_PASSWORD)

        status, sprint = request("GET", f"/sprints/current?companyId={COMPANY_ID}", manager_token)
        check("Активная неделя демо-компании найдена", status in (200, 201) and bool(sprint.get("id")))

        entry_number = 900000 + int(time.time()) % 90000
        status, entry = request("POST", "/entries", manager_token, {
            "sprintId": sprint["id"],
            "managerId": manager["id"],
            "companyId": COMPANY_ID,
            "type": "chat",
            "entryNumber": entry_number,
            "entryDate": "2026-09-09",
            "source": "E2E удаления черновика",
        })
        check("Менеджер создал тестовый черновик", status in (200, 201), f"HTTP {status}")
        created_id = entry["id"]

        status, _ = request("DELETE", f"/entries/{created_id}", manager_token)
        check("Менеджер не может удалить запись сам", status == 403, f"HTTP {status}")

        status, _ = request("DELETE", f"/entries/{created_id}", reviewer_token)
        check("РОП удалил черновик менеджера", status in (200, 204), f"HTTP {status}")

        status, _ = request("GET", f"/entries/{created_id}", reviewer_token)
        check("Удалённый черновик исчез из API", status == 404, f"HTTP {status}")

        status, entries = request("GET", f"/entries?companyId={COMPANY_ID}", reviewer_token)
        check("Записи демо-компании получены", status == 200 and isinstance(entries, list), f"HTTP {status}")
        protected = next((item for item in entries if item.get("status") in ("submitted", "reviewed")), None)
        check("Найдена отправленная запись для контр-проверки", protected is not None)

        status, payload = request("DELETE", f"/entries/{protected['id']}", reviewer_token)
        check(
            "РОП не может удалить отправленную или проверенную запись",
            status == 400 and "только черновик" in str(payload.get("message", "")),
            f"HTTP {status}",
        )
        print("\nИТОГ: прод-сценарий удаления черновика пройден")
        return 0
    except (AssertionError, RuntimeError) as error:
        print(f"\nИТОГ: прод-сценарий не пройден ({error})")
        return 1
    finally:
        cleanup(created_id)


if __name__ == "__main__":
    sys.exit(main())
