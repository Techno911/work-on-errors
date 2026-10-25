# -*- coding: utf-8 -*-
"""Замер витрины на 360 и 390 для ворот выпуска.

Детектор не копируется: берётся из webcheck.py (вылет документа вбок, элементы за краем,
наложение контролов, обрезанный текст, три условия: обычные, без веб-шрифтов, крупный текст).
Отличие от `webcheck --quick` одно: две ширины и один движок, чтобы ворота выпуска шли минуты, а не
четверть часа. Полная матрица остаётся в `npm run check`.

Вызов: webcheck-narrow.py <путь к webcheck.py> <база витрины> <путь страницы>...
Код выхода 0 — чисто, 1 — есть ломающие находки, 2 — замер не выполнился.
"""
import asyncio
import importlib.util
import re
import sys

WIDTHS = [360, 390]
ENGINES = ['chromium']
PARALLEL = 4
SUMMARY_LINES = 12  # вылет документа виден первым; остальное читается в подробном отчёте
DETAIL_PAGES = 3


def load_webcheck(path):
    spec = importlib.util.spec_from_file_location('webcheck', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def overflow_px(finding):
    match = re.match(r'(\d+) при ширине (\d+)', finding.get('note', ''))
    return int(match.group(1)) - int(match.group(2)) if match else None


async def measure(wc, base, pages):
    gate = asyncio.Semaphore(PARALLEL)

    async def one(path):
        async with gate:
            return path, await wc.run(base + path, ENGINES, WIDTHS, None)

    return await asyncio.gather(*(one(path) for path in pages))


def main():
    webcheck_path, base, *pages = sys.argv[1:]
    wc = load_webcheck(webcheck_path)
    try:
        results = asyncio.run(measure(wc, base, pages))
    except Exception as error:  # браузер не запустился или страница не открылась
        print(f'Замер витрины на 360 и 390 не выполнился: {error}')
        sys.exit(2)

    failed = []
    for path, (findings, notes, redirected) in results:
        blockers = [f for f in findings if f['kind'] in wc.BLOCKERS]
        if blockers or notes or redirected:
            failed.append((path, findings, notes, redirected, blockers))

    if not failed:
        print(f'Замер витрины: {len(pages)} страниц на ширинах 360 и 390 (chromium, три условия) — ломающих находок нет.')
        return

    print(f'\nВОРОТА ВЫПУСКА: замер витрины на 360 и 390 красный, страниц с находками {len(failed)} из {len(pages)}.')
    lines = []
    for path, findings, notes, redirected, blockers in failed:
        for (kind, element, text), items in wc.group(blockers).items():
            widths = sorted({item['width'] for item in items})
            px = overflow_px(items[0])
            size = f', вылет на {px} px' if px is not None else f', {items[0].get("note", "")}'
            lines.append((px is None, f'  ✗ {path} · ширина {"/".join(map(str, widths))} · {element} · {kind}{size}'))
        if redirected:
            lines.append((True, f'  ✗ {path} · открылась другая страница: {", ".join(sorted(redirected))}'))
        for name, why in notes:
            lines.append((True, f'  ✗ {path} · {name}: {why}'))
    lines.sort(key=lambda line: line[0])  # сначала вылет документа вбок
    for _, line in lines[:SUMMARY_LINES]:
        print(line)
    if len(lines) > SUMMARY_LINES:
        print(f'  … ещё {len(lines) - SUMMARY_LINES} находок')
    print(f'\nПодробный отчёт (первые {min(DETAIL_PAGES, len(failed))} страницы с находками):')
    for path, findings, notes, redirected, _ in failed[:DETAIL_PAGES]:
        wc.report(findings, notes, path, redirected)
    sys.exit(1)


if __name__ == '__main__':
    main()
