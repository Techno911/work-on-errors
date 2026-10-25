import sys

from playwright.sync_api import sync_playwright


url = sys.argv[1]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(url, wait_until="networkidle")

    result = page.evaluate("""
      () => {
        const card = document.querySelector('#card-layout-contract');
        if (!card) throw new Error('Нет проверочной Card');
        const alignedInput = document.querySelector('#input-align-end');
        if (!alignedInput) throw new Error('Нет проверочного Input align=end');
        const monoInput = document.querySelector('#input-font-mono');
        const monoTextarea = document.querySelector('#textarea-font-mono');
        if (!monoInput || !monoTextarea) throw new Error('Нет проверочных mono-полей');
        const baseButton = document.querySelector('#button-loading-base');
        const idleButton = document.querySelector('#button-loading-idle');
        const busyButton = document.querySelector('#button-loading-busy');
        const baseLink = document.querySelector('#link-loading-base');
        const idleLink = document.querySelector('#link-loading-idle');
        const busyLink = document.querySelector('#link-loading-busy');
        if (!baseButton || !idleButton || !busyButton || !baseLink || !idleLink || !busyLink) {
          throw new Error('Нет проверочных loading-контролов');
        }
        const dateField = document.querySelector('.chip-date-field');
        if (!dateField) throw new Error('Нет проверочного DateField');
        const probe = document.createElement('div');
        probe.style.background = 'var(--chip-color-surface)';
        document.body.append(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const containers = [
          '.chip-shell', '.chip-brand-logo', '.chip-input-wrap', '.chip-list-row',
          '.chip-dropdown', '.chip-progress', '.chip-tabs', '.chip-tooltip',
          '.chip-user-block', '.chip-topbar', '.chip-card', '.chip-empty-state',
          '.chip-notice', '.chip-toast', '.chip-file-field'
        ];
        const atomics = [
          '.chip-button', '.chip-icon-button', '.chip-input', '.chip-textarea', '.chip-select', '.chip-choice',
          '.chip-switch', '.chip-nav-item', '.chip-sidebar-toggle', '.chip-badge'
        ];
        const badContainers = containers.flatMap((selector) => {
          const element = document.querySelector(selector);
          return element && getComputedStyle(element).minWidth !== '0px'
            ? [`${selector}=${getComputedStyle(element).minWidth}`]
            : [];
        });
        const badAtomics = atomics.flatMap((selector) => {
          const element = document.querySelector(selector);
          return element && getComputedStyle(element).minWidth === '0px'
            ? [`${selector}=0px`]
            : [];
        });
        return {
          width: card.getBoundingClientRect().width,
          background: getComputedStyle(card).backgroundColor,
          expectedBackground,
          badContainers,
          badAtomics,
          inputTextAlign: getComputedStyle(alignedInput).textAlign,
          inputNumericVariant: getComputedStyle(alignedInput).fontVariantNumeric,
          monoInputFamily: getComputedStyle(monoInput).fontFamily,
          monoTextareaFamily: getComputedStyle(monoTextarea).fontFamily,
          monoTextareaResize: getComputedStyle(monoTextarea).resize,
          buttonLoading: [baseButton, idleButton, busyButton].map((button) => {
            const bounds = button.getBoundingClientRect();
            const label = button.querySelector('.chip-button__label').getBoundingClientRect();
            return { width: bounds.width, labelCenter: label.left + label.width / 2 - bounds.left };
          }),
          linkLoading: [baseLink, idleLink, busyLink].map((button) => {
            const bounds = button.getBoundingClientRect();
            const label = button.querySelector('.chip-button__label').getBoundingClientRect();
            return { width: bounds.width, labelCenter: label.left + label.width / 2 - bounds.left };
          }),
          dateSelects: dateField.querySelectorAll('select').length,
          nativeDates: document.querySelectorAll('input[type="date"]').length,
        };
      }
    """)
    date_layouts = {}
    link_layouts = {}
    for viewport_width in (360, 390, 1280):
        page.set_viewport_size({"width": viewport_width, "height": 900})
        page.goto(url, wait_until="networkidle")
        date_layouts[viewport_width] = page.evaluate("""
          () => {
            const fields = [...document.querySelectorAll('.chip-date-field__controls')];
            const card = document.querySelector('#date-field-demo-card');
            const referenceInput = card?.querySelector('.chip-field input');
            const referenceSelect = card?.querySelector('.chip-field .chip-select select');
            const referenceArrow = referenceSelect?.parentElement?.querySelector('svg');
            if (!card || !referenceInput || !referenceSelect || !referenceArrow) {
              throw new Error('Нет эталонных Input и Select рядом с DateField');
            }
            const rows = fields.map((field) => {
              const parts = [...field.querySelectorAll('.chip-date-field__part')];
              const tops = parts.map((part) => part.getBoundingClientRect().top);
              return Math.max(...tops) - Math.min(...tops);
            });
            const dateSelects = [...document.querySelectorAll('.chip-date-field select')];
            const targets = [
              dateSelects.find((select) => select.value === '' && select.options[0].text === 'День'),
              dateSelects.find((select) => select.value === '09'),
              dateSelects.find((select) => select.value === '2024'),
            ];
            if (targets.some((target) => !target)) {
              throw new Error('Нет значений «День», «сентября» или «2024»');
            }
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const fit = targets.map((select) => {
              const style = getComputedStyle(select);
              context.font = style.font;
              const text = select.options[select.selectedIndex].text;
              const requiredWidth = context.measureText(text).width
                + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
              return { text, width: select.clientWidth, requiredWidth };
            });
            const inputStyle = getComputedStyle(referenceInput);
            const inputBounds = referenceInput.getBoundingClientRect();
            const inputInset = parseFloat(inputStyle.borderLeftWidth) + parseFloat(inputStyle.paddingLeft);
            const dateInsets = dateSelects.map((select) => {
              const style = getComputedStyle(select);
              return parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
            });
            const firstDateBounds = dateSelects[0].getBoundingClientRect();
            const dateArrows = [...document.querySelectorAll('.chip-date-field .chip-select > svg')];
            return {
              rows,
              controlsWidth: Math.min(...fields.map((field) => field.getBoundingClientRect().width)),
              fit,
              inputInset,
              dateInsets,
              firstTextX: firstDateBounds.left + dateInsets[0],
              inputTextX: inputBounds.left + inputInset,
              referenceArrowWidth: referenceArrow.getBoundingClientRect().width,
              dateArrowWidths: dateArrows.map((arrow) => arrow.getBoundingClientRect().width),
            };
          }
        """)
        page.locator('#link-alignment-value').focus()
        link_layouts[viewport_width] = page.evaluate("""
          () => {
            const label = document.querySelector('#link-alignment-label');
            const link = document.querySelector('#link-alignment-value');
            const linkLabel = link?.querySelector('.chip-button__label');
            const pair = [...document.querySelectorAll('#link-pair .chip-button')];
            if (!label || !link || !linkLabel || pair.length !== 2) {
              throw new Error('Нет проверочных ссылок');
            }
            const hitRects = pair.map((element) => {
              const bounds = element.getBoundingClientRect();
              const pseudo = getComputedStyle(element, '::after');
              const width = parseFloat(pseudo.width);
              const height = parseFloat(pseudo.height);
              return {
                left: bounds.left + bounds.width / 2 - width / 2,
                right: bounds.left + bounds.width / 2 + width / 2,
                top: bounds.top + bounds.height / 2 - height / 2,
                bottom: bounds.top + bounds.height / 2 + height / 2,
                width,
                height,
              };
            });
            const overlaps = hitRects[0].left < hitRects[1].right
              && hitRects[0].right > hitRects[1].left
              && hitRects[0].top < hitRects[1].bottom
              && hitRects[0].bottom > hitRects[1].top;
            return {
              labelX: label.getBoundingClientRect().left,
              linkTextX: linkLabel.getBoundingClientRect().left,
              outlineOffset: parseFloat(getComputedStyle(link).outlineOffset),
              hitRects,
              overlaps,
            };
          }
        """)
    topbar_layouts = {}
    base_url = url.rsplit('/', 1)[0]
    for viewport_width in (1024, 1280):
        page.set_viewport_size({"width": viewport_width, "height": 900})
        page.goto(f'{base_url}/topbar-description-actions', wait_until="networkidle")
        topbar_layouts[viewport_width] = page.evaluate("""
          () => {
            const topbar = document.querySelector('.chip-topbar');
            const description = document.querySelector('.chip-topbar__description');
            const actions = document.querySelector('.chip-topbar__actions');
            if (!topbar || !description || !actions) throw new Error('Нет проверочного TopBar');
            const descriptionBounds = description.getBoundingClientRect();
            const actionsBounds = actions.getBoundingClientRect();
            const verticalOverlap = descriptionBounds.top < actionsBounds.bottom
              && descriptionBounds.bottom > actionsBounds.top;
            const horizontalOverlap = descriptionBounds.left < actionsBounds.right
              && descriptionBounds.right > actionsBounds.left;
            return {
              whiteSpace: getComputedStyle(description).whiteSpace,
              overlaps: verticalOverlap && horizontalOverlap,
              overflow: topbar.scrollWidth - topbar.clientWidth,
            };
          }
        """)
    table_layouts = {}
    for viewport_width in (1280, 360, 390):
        page.set_viewport_size({"width": viewport_width, "height": 1100})
        page.goto(f'{base_url}/tables', wait_until="networkidle")
        page.wait_for_timeout(100)
        table_layouts[viewport_width] = page.evaluate("""
          (viewportWidth) => {
            const cards = document.querySelector('#table-cards-demo');
            const scrollTable = document.querySelector('#table-scroll-demo');
            const emptyTable = document.querySelector('#table-empty-demo');
            const badgeTable = document.querySelector('#table-badge-demo');
            const numericCell = scrollTable?.querySelector('.chip-table__cell--numeric');
            const palette = [...document.querySelectorAll('#category-palette .chip-avatar')];
            if (!cards || !scrollTable || !emptyTable || !badgeTable || !numericCell || palette.length !== 8) {
              throw new Error('Нет полной проверочной витрины Table и Avatar');
            }
            const cardCells = [...cards.querySelectorAll('tbody .chip-table__row:first-child td.chip-table__cell')];
            const cardAllCells = [...cards.querySelectorAll('tbody .chip-table__row:first-child td')];
            const cardRow = cards.querySelector('tbody .chip-table__row:first-child');
            const cardNumericCell = cards.querySelector('tbody .chip-table__row:first-child .chip-table__cell--numeric');
            const cardNumericLabel = cardNumericCell?.querySelector('.chip-table__mobile-label');
            const cardNumericValue = cardNumericCell?.querySelector('.chip-table__value');
            const cardAction = cards.querySelector('tbody .chip-table__row:first-child .chip-table__action');
            const scrollAction = scrollTable.querySelector('tbody .chip-table__row:first-child .chip-table__action');
            const badge = [...badgeTable.querySelectorAll('.chip-badge')]
              .find((element) => element.textContent === 'Требует подтверждения');
            if (!cardRow || !cardNumericCell || !cardNumericLabel || !cardNumericValue
              || !cardAction || !scrollAction || !badge) {
              throw new Error('Нет проверочной карточки с числовым полем');
            }
            const textLeft = (element) => {
              const node = element.firstChild;
              if (!node) throw new Error('Нет текста для замера Table cards');
              const range = document.createRange();
              range.selectNodeContents(node);
              return range.getBoundingClientRect().left;
            };
            const labelsAbove = cardCells.every((cell) => {
              const label = cell.querySelector('.chip-table__mobile-label');
              const value = cell.querySelector('.chip-table__value');
              if (!label || !value) return false;
              const labelBounds = label.getBoundingClientRect();
              const valueBounds = value.getBoundingClientRect();
              return labelBounds.height > 0 && labelBounds.bottom <= valueBounds.top + 0.5;
            });
            const hitRect = (element) => {
              const bounds = element.getBoundingClientRect();
              const pseudo = getComputedStyle(element, '::after');
              const width = parseFloat(pseudo.width);
              const height = parseFloat(pseudo.height);
              return {
                left: bounds.left + bounds.width / 2 - width / 2,
                right: bounds.left + bounds.width / 2 + width / 2,
                top: bounds.top + bounds.height / 2 - height / 2,
                bottom: bounds.top + bounds.height / 2 + height / 2,
              };
            };
            const overlaps = (first, second) => first.left < second.right
              && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
            const actionGeometry = (cell) => {
              const value = cell.querySelector('.chip-table__value');
              const controls = [...cell.querySelectorAll('.chip-button')];
              if (!value || controls.length !== 2) throw new Error('Нет двух действий Table');
              const valueBounds = value.getBoundingClientRect();
              const cellBounds = cell.getBoundingClientRect();
              const style = getComputedStyle(cell);
              return {
                cellLeft: cellBounds.left,
                cellRight: cellBounds.right,
                cellWidth: cellBounds.width,
                cellHeight: cellBounds.height,
                paddingTop: parseFloat(style.paddingTop),
                paddingBottom: parseFloat(style.paddingBottom),
                paddingLeft: parseFloat(style.paddingLeft),
                paddingRight: parseFloat(style.paddingRight),
                valueLeft: valueBounds.left,
                valueRight: valueBounds.right,
                controlTops: controls.map((control) => control.getBoundingClientRect().top),
                controlHeights: controls.map((control) => control.getBoundingClientRect().height),
                controlCenters: controls.map((control) => {
                  const bounds = control.getBoundingClientRect();
                  return bounds.top + bounds.height / 2;
                }),
                labelLines: controls.map((control) => {
                  const label = control.querySelector('.chip-button__label');
                  const range = document.createRange();
                  range.selectNodeContents(label);
                  return range.getClientRects().length;
                }),
              };
            };
            const cardActions = actionGeometry(cardAction);
            const scrollActions = actionGeometry(scrollAction);
            let wrappedActionZones = null;
            if (viewportWidth <= 768) {
              const value = cardAction.querySelector('.chip-table__value');
              value.style.width = '150px';
              const controls = [...cardAction.querySelectorAll('.chip-button')];
              const zones = controls.map(hitRect);
              wrappedActionZones = {
                overlap: overlaps(zones[0], zones[1]),
                first: zones[0],
                second: zones[1],
                verticalDistance: Math.abs(
                  (zones[1].top + zones[1].bottom) / 2 - (zones[0].top + zones[0].bottom) / 2,
                ),
              };
              value.style.width = '';
            }
            const manyTable = document.querySelector('#table-cards-many-actions-demo');
            const manyRow = manyTable?.querySelector('tbody .chip-table__row:first-child');
            const manyCell = manyRow?.querySelector('.chip-table__action');
            const manyControls = manyCell ? [...manyCell.querySelectorAll('.chip-button')] : [];
            if (!manyRow || !manyCell || manyControls.length !== 3) {
              throw new Error('Нет проверочной карточки с тремя действиями Table');
            }
            const manyCellBounds = manyCell.getBoundingClientRect();
            const manyStyle = getComputedStyle(manyCell);
            const manyActions = {
              documentWidth: document.documentElement.scrollWidth,
              whiteSpace: manyStyle.whiteSpace,
              rowRight: manyRow.getBoundingClientRect().right,
              cellRight: manyCellBounds.right,
              contentLeft: manyCellBounds.left + parseFloat(manyStyle.paddingLeft),
              contentRight: manyCellBounds.right - parseFloat(manyStyle.paddingRight),
              controls: manyControls.map((control) => {
                const bounds = control.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(control.querySelector('.chip-button__label'));
                return {
                  left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
                  lines: range.getClientRects().length,
                };
              }),
              zonesOverlap: manyControls.map(hitRect).some((zone, index, zones) => (
                zones.slice(index + 1).some((other) => overlaps(zone, other))
              )),
            };
            const scroll = scrollTable.querySelector('.chip-table__scroll');
            const rightEdge = scrollTable.querySelector('.chip-table__edge--right');
            const empty = emptyTable.querySelector('.chip-table__empty');
            const headers = emptyTable.querySelectorAll('thead th');
            const emptyScroll = emptyTable.querySelector('.chip-table__scroll');
            const emptyFrame = emptyTable.querySelector('.chip-table__frame');
            const actionHeadingLabel = scrollTable.querySelector('.chip-table__action-heading-label');
            const actionHeading = scrollTable.querySelector('.chip-table__action-heading');
            if (!empty || !emptyScroll || !emptyFrame || !actionHeadingLabel || !actionHeading) {
              throw new Error('Нет проверочного пустого состояния или заголовка действий');
            }
            const backgrounds = palette.map((avatar) => getComputedStyle(avatar).backgroundColor);
            const cardRowStyle = getComputedStyle(cardRow);
            const emptyBounds = empty.getBoundingClientRect();
            const emptyFrameBounds = emptyFrame.getBoundingClientRect();
            const emptyStyle = getComputedStyle(empty);
            const badgeBounds = badge.getBoundingClientRect();
            const badgeCellBounds = badge.closest('td').getBoundingClientRect();
            const badgeRange = document.createRange();
            badgeRange.selectNodeContents(badge);
            const heading = scrollTable.querySelector('thead th');
            const canvasProbe = document.createElement('span');
            canvasProbe.style.background = 'var(--chip-color-canvas)';
            document.body.append(canvasProbe);
            const canvasColor = getComputedStyle(canvasProbe).backgroundColor;
            canvasProbe.remove();
            return {
              labelsAbove,
              cardCellCount: cardCells.length,
              cardFieldBorders: cardAllCells.map((cell) => {
                const style = getComputedStyle(cell);
                return { top: parseFloat(style.borderTopWidth), bottom: parseFloat(style.borderBottomWidth) };
              }),
              cardRowBorders: {
                left: parseFloat(cardRowStyle.borderLeftWidth),
                right: parseFloat(cardRowStyle.borderRightWidth),
                bottom: parseFloat(cardRowStyle.borderBottomWidth),
                radius: parseFloat(cardRowStyle.borderTopLeftRadius),
              },
              cardNumericLabelX: textLeft(cardNumericLabel),
              cardNumericValueX: textLeft(cardNumericValue),
              cardNumericVariant: getComputedStyle(cardNumericValue).fontVariantNumeric,
              cardActions,
              scrollActions,
              wrappedActionZones,
              manyActions,
              cardActionHasVisibleLabel: Boolean(cardAction.querySelector('.chip-table__mobile-label')),
              actionHeadingLabel: {
                text: actionHeadingLabel.textContent,
                clipPath: getComputedStyle(actionHeadingLabel).clipPath,
              },
              actionHeadingWidth: actionHeading.getBoundingClientRect().width,
              headingBackground: getComputedStyle(heading).backgroundColor,
              canvasColor,
              badge: {
                lines: badgeRange.getClientRects().length,
                whiteSpace: getComputedStyle(badge).whiteSpace,
                left: badgeBounds.left,
                right: badgeBounds.right,
                cellLeft: badgeCellBounds.left,
                cellRight: badgeCellBounds.right,
              },
              numericAlign: getComputedStyle(numericCell).textAlign,
              numericVariant: getComputedStyle(numericCell).fontVariantNumeric,
              overflow: scroll.scrollWidth - scroll.clientWidth,
              rightEdge: Boolean(rightEdge),
              emptyText: empty?.textContent,
              headerCount: headers.length,
              empty: {
                outsideScroll: !empty.closest('.chip-table__scroll'),
                whiteSpace: emptyStyle.whiteSpace,
                textAlign: emptyStyle.textAlign,
                left: emptyBounds.left,
                right: emptyBounds.right,
                frameLeft: emptyFrameBounds.left,
                frameRight: emptyFrameBounds.right,
                overflow: empty.scrollWidth - empty.clientWidth,
                headerOverflow: emptyScroll.scrollWidth - emptyScroll.clientWidth,
              },
              paletteUnique: new Set(backgrounds).size,
              paletteTransparent: backgrounds.some((color) => color === 'rgba(0, 0, 0, 0)'),
            };
          }
        """, viewport_width)
    browser.close()

if abs(result["width"] - 448) > 0.5:
    raise SystemExit(f'Card max-w-md: ожидалось 448, получено {result["width"]}')
if result["background"] != result["expectedBackground"]:
    raise SystemExit(
        'Card bg-red-500 изменил пакетный фон: '
        f'{result["background"]} вместо {result["expectedBackground"]}'
    )
if result["badContainers"]:
    raise SystemExit('Контейнеры без min-width:0: ' + ', '.join(result["badContainers"]))
if result["badAtomics"]:
    raise SystemExit('Атомарные контролы с min-width:0: ' + ', '.join(result["badAtomics"]))
if result["inputTextAlign"] not in ("end", "right"):
    raise SystemExit(f'Input align=end: ожидалось end/right, получено {result["inputTextAlign"]}')
if "tabular-nums" not in result["inputNumericVariant"]:
    raise SystemExit(
        'Input align=end: нет tabular-nums, получено '
        f'{result["inputNumericVariant"]}'
    )
for field in ("monoInputFamily", "monoTextareaFamily"):
    if "IBM Plex Mono" not in result[field]:
        raise SystemExit(f'{field}: ожидался IBM Plex Mono, получено {result[field]}')
if result["monoTextareaResize"] != "none":
    raise SystemExit(f'Textarea resize=none: ожидалось none, получено {result["monoTextareaResize"]}')
for control in ("buttonLoading", "linkLoading"):
    widths = [state["width"] for state in result[control]]
    centers = [state["labelCenter"] for state in result[control]]
    if max(widths) - min(widths) > 0.5:
        raise SystemExit(f'{control}: loading изменил ширину: {widths}')
    if max(centers) - min(centers) > 0.5:
        raise SystemExit(f'{control}: loading сместил подпись: {centers}')
if result["dateSelects"] != 3 or result["nativeDates"] != 0:
    raise SystemExit(
        'DateField: ожидалось 3 Select и 0 input[type=date], получено '
        f'{result["dateSelects"]} / {result["nativeDates"]}'
    )
for viewport_width, layout in date_layouts.items():
    if any(delta > 0.5 for delta in layout["rows"]):
        raise SystemExit(f'DateField {viewport_width}: части стоят на разных строках: {layout["rows"]}')
    if viewport_width == 360 and layout["controlsWidth"] < 296:
        raise SystemExit(
            f'DateField 360: доступная ширина меньше 296 px: {layout["controlsWidth"]}'
        )
    if abs(layout["firstTextX"] - layout["inputTextX"]) > 1:
        raise SystemExit(
            f'DateField {viewport_width}: левый край текста не совпал с Input: '
            f'{layout["firstTextX"]} / {layout["inputTextX"]}'
        )
    if any(abs(inset - layout["inputInset"]) > 1 for inset in layout["dateInsets"]):
        raise SystemExit(
            f'DateField {viewport_width}: отступ текста отличается от Input: '
            f'{layout["dateInsets"]} / {layout["inputInset"]}'
        )
    if any(abs(width - layout["referenceArrowWidth"]) > 0.5 for width in layout["dateArrowWidths"]):
        raise SystemExit(
            f'DateField {viewport_width}: размер стрелки отличается от Select: '
            f'{layout["dateArrowWidths"]} / {layout["referenceArrowWidth"]}'
        )
    for item in layout["fit"]:
        if item["width"] + 0.5 < item["requiredWidth"]:
            raise SystemExit(
                f'DateField {viewport_width}: «{item["text"]}» обрезается: '
                f'{item["width"]} < {item["requiredWidth"]}'
            )
for viewport_width, layout in link_layouts.items():
    if abs(layout["linkTextX"] - layout["labelX"]) > 1:
        raise SystemExit(
            f'Button link {viewport_width}: левый край текста не совпал с подписью: '
            f'{layout["linkTextX"]} / {layout["labelX"]}'
        )
    if layout["outlineOffset"] < 2:
        raise SystemExit(
            f'Button link {viewport_width}: кольцо фокуса прилипло к тексту: '
            f'{layout["outlineOffset"]}'
        )
    if viewport_width <= 768:
        if any(rect["width"] < 44 or rect["height"] < 44 for rect in layout["hitRects"]):
            raise SystemExit(
                f'Button link {viewport_width}: зона касания меньше 44: '
                f'{layout["hitRects"]}'
            )
        if layout["overlaps"]:
            raise SystemExit(
                f'Button link {viewport_width}: зоны соседних ссылок перекрываются'
            )
for viewport_width, layout in topbar_layouts.items():
    if layout["whiteSpace"] != "normal":
        raise SystemExit(f'TopBar {viewport_width}: описание не переносится: {layout["whiteSpace"]}')
    if layout["overlaps"]:
        raise SystemExit(f'TopBar {viewport_width}: описание заехало под действия')
    if layout["overflow"] > 0.5:
        raise SystemExit(f'TopBar {viewport_width}: содержимое вышло на {layout["overflow"]} px')

for viewport_width, layout in table_layouts.items():
    if layout["emptyText"] != "Матрица приоритета не содержит данных за выбранный период" or layout["headerCount"] != 4:
        raise SystemExit(f'Table {viewport_width}: пустое состояние или заголовок потеряны: {layout}')
    if not layout["empty"]["outsideScroll"] or layout["empty"]["whiteSpace"] != "normal":
        raise SystemExit(f'Table empty {viewport_width}: сообщение осталось внутри прокрутки: {layout["empty"]}')
    if layout["empty"]["textAlign"] not in ("start", "left"):
        raise SystemExit(f'Table empty {viewport_width}: сообщение не у левого края: {layout["empty"]}')
    if (layout["empty"]["left"] < layout["empty"]["frameLeft"] - 0.5
            or layout["empty"]["right"] > layout["empty"]["frameRight"] + 0.5
            or layout["empty"]["overflow"] > 0.5):
        raise SystemExit(f'Table empty {viewport_width}: сообщение вышло за видимую рамку: {layout["empty"]}')
    if viewport_width <= 768 and layout["empty"]["headerOverflow"] <= 1:
        raise SystemExit(f'Table empty {viewport_width}: проверочная шапка не создаёт прокрутку: {layout["empty"]}')
    if layout["headingBackground"] != layout["canvasColor"]:
        raise SystemExit(
            f'Table header {viewport_width}: фон не canvas: '
            f'{layout["headingBackground"]} / {layout["canvasColor"]}'
        )
    if layout["actionHeadingLabel"]["text"] != "Действия" or layout["actionHeadingLabel"]["clipPath"] == "none":
        raise SystemExit(f'Table actions {viewport_width}: заголовок действий виден или недоступен: {layout["actionHeadingLabel"]}')
    if layout["badge"]["lines"] != 1 or layout["badge"]["whiteSpace"] != "nowrap":
        raise SystemExit(f'Badge {viewport_width}: подпись перенеслась: {layout["badge"]}')
    if layout["badge"]["left"] < layout["badge"]["cellLeft"] - 0.5 or layout["badge"]["right"] > layout["badge"]["cellRight"] + 0.5:
        raise SystemExit(f'Badge {viewport_width}: метка вышла из ячейки: {layout["badge"]}')
    for mode in ("cardActions", "scrollActions"):
        actions = layout[mode]
        if any(lines != 1 for lines in actions["labelLines"]):
            raise SystemExit(f'Table actions {mode} {viewport_width}: подпись перенеслась: {actions}')
        if any(abs(height - 32) > 0.5 for height in actions["controlHeights"]):
            raise SystemExit(f'Table actions {mode} {viewport_width}: действие не size=sm 32: {actions}')
        if max(actions["controlCenters"]) - min(actions["controlCenters"]) > 0.5:
            raise SystemExit(f'Table actions {mode} {viewport_width}: действия не стоят в ряд: {actions}')
        if (actions["valueLeft"] < actions["cellLeft"] + actions["paddingLeft"] - 1
                or actions["valueRight"] > actions["cellRight"] - actions["paddingRight"] + 1):
            raise SystemExit(f'Table actions {mode} {viewport_width}: ряд не помещается в колонку: {actions}')
    if abs(layout["actionHeadingWidth"] - layout["scrollActions"]["cellWidth"]) > 0.5:
        raise SystemExit(
            f'Table actions {viewport_width}: шапка и строки получили разную ширину колонки: '
            f'{layout["actionHeadingWidth"]} / {layout["scrollActions"]["cellWidth"]}'
        )
    many = layout["manyActions"]
    if many["documentWidth"] > viewport_width + 0.5:
        raise SystemExit(f'Table actions {viewport_width}: страница шире экрана из-за ряда действий: {many}')
    if many["cellRight"] > many["rowRight"] + 0.5:
        raise SystemExit(f'Table actions {viewport_width}: ячейка действий вышла из записи: {many}')
    if any(control["lines"] != 1 or control["left"] < many["contentLeft"] - 1
           or control["right"] > many["contentRight"] + 1 for control in many["controls"]):
        raise SystemExit(f'Table actions {viewport_width}: действие вышло из ячейки или перенеслось: {many}')
    if many["zonesOverlap"]:
        raise SystemExit(f'Table actions {viewport_width}: зоны трёх действий перекрылись: {many}')
    action_rows = []
    for control in sorted(many["controls"], key=lambda item: item["top"]):
        if action_rows and abs(control["top"] - action_rows[-1]["top"]) <= 0.5:
            action_rows[-1]["bottom"] = max(action_rows[-1]["bottom"], control["bottom"])
        else:
            action_rows.append({"top": control["top"], "bottom": control["bottom"]})
    if viewport_width > 768 and len(action_rows) != 1:
        raise SystemExit(f'Table actions {viewport_width}: три действия на компьютере не в одном ряду: {many}')
    if viewport_width <= 390 and len(action_rows) < 2:
        raise SystemExit(f'Table actions {viewport_width}: проверочный ряд перестал переноситься, замер ничего не проверяет: {many}')
    if any(below["top"] - above["bottom"] < 11.5 for above, below in zip(action_rows, action_rows[1:])):
        raise SystemExit(f'Table actions {viewport_width}: между рядами действий меньше 12: {many}')
    if layout["paletteUnique"] != 8 or layout["paletteTransparent"]:
        raise SystemExit(f'Avatar {viewport_width}: восемь цветов палитры не различаются: {layout}')
    if viewport_width <= 768:
        if layout["cardCellCount"] != 3 or not layout["labelsAbove"]:
            raise SystemExit(f'Table cards {viewport_width}: подпись не стоит над значением: {layout}')
        if abs(layout["cardNumericLabelX"] - layout["cardNumericValueX"]) > 1:
            raise SystemExit(
                f'Table cards {viewport_width}: число оторвано от подписи: '
                f'{layout["cardNumericLabelX"]} / {layout["cardNumericValueX"]}'
            )
        if "tabular-nums" not in layout["cardNumericVariant"]:
            raise SystemExit(
                f'Table cards {viewport_width}: у числа нет tabular-nums: '
                f'{layout["cardNumericVariant"]}'
            )
        if any(border["top"] > 0 or border["bottom"] > 0 for border in layout["cardFieldBorders"]):
            raise SystemExit(
                f'Table cards {viewport_width}: внутри записи остались разделители: '
                f'{layout["cardFieldBorders"]}'
            )
        row_borders = layout["cardRowBorders"]
        if row_borders["left"] > 0 or row_borders["right"] > 0 or row_borders["radius"] > 0 or row_borders["bottom"] <= 0:
            raise SystemExit(
                f'Table cards {viewport_width}: запись не отделена одной линией снизу: '
                f'{row_borders}'
            )
        if layout["overflow"] <= 1 or not layout["rightEdge"]:
            raise SystemExit(f'Table scroll {viewport_width}: нет реального переполнения или тени: {layout}')
        if layout["cardActionHasVisibleLabel"]:
            raise SystemExit(f'Table cards {viewport_width}: над действиями появилась подпись')
        if abs(layout["cardActions"]["valueLeft"] - (layout["cardActions"]["cellLeft"] + 16)) > 1:
            raise SystemExit(f'Table cards {viewport_width}: действия не у левого края: {layout["cardActions"]}')
        if layout["wrappedActionZones"]["overlap"]:
            raise SystemExit(
                f'Table cards {viewport_width}: зоны действий перекрылись после переноса: '
                f'{layout["wrappedActionZones"]}'
            )
    if viewport_width == 1280:
        if layout["numericAlign"] not in ("end", "right"):
            raise SystemExit(f'Table numeric {viewport_width}: не выровнен вправо: {layout}')
        if "tabular-nums" not in layout["numericVariant"]:
            raise SystemExit(f'Table numeric {viewport_width}: нет tabular-nums: {layout}')
    for mode in ("cardActions", "scrollActions"):
        actions = layout[mode]
        if viewport_width > 768 and abs(actions["valueRight"] - (actions["cellRight"] - 16)) > 1:
            raise SystemExit(f'Table actions {mode} {viewport_width}: ряд не у правого края: {actions}')
        if viewport_width > 768 and (abs(actions["cellHeight"] - 44) > 0.5
                                     or abs(actions["paddingTop"] - 4) > 0.5
                                     or abs(actions["paddingBottom"] - 4) > 0.5):
            raise SystemExit(f'Table actions {mode} {viewport_width}: ячейка не 44/4: {actions}')

print('Раскладка: Card = 448; Table actions/empty/Badge и Avatar измерены.')
