# История изменений

## 0.10.0 — 25.09.2026

- Добавлено (канон оболочки, раздел 14): номер версии платформы стоит ровно в двух местах, и оба
  рисует пакет в форме «Название, vX.Y.Z». Первое: последняя строка блока пользователя в
  развёрнутой панели (`.chip-user-block__version`, моно, кегль 12, `on-inverse-muted`, одна строка
  с многоточием). В свёрнутой панели строки нет, номер уходит в подсказку знака: `title`
  `BrandMark` = «Название, vX.Y.Z». Второе: строка под кнопкой на экране входа сотрудников
  (`.chip-login__version`, теперь тоже с `data-chip-version`). Название берётся из `product`,
  платформа передаёт только номер. Межстрочное строки панели: токен кегля 12 как пол
  (`max(…, 1.2em)`), поэтому при обычном тексте она ровно 16 px, а при крупном растёт вместе
  с кеглем и моноширинный шрифт не режется по высоте (`webcheck`, «крупный текст»).
- Ломающее: `AppShell` требует `version: VersionNumber` (`"8.3.0"`), `UserBlock` требует
  `product` и `version`; `LoginShell.version` стал `VersionNumber` вместо `ReactNode`, без пропа
  строки нет (публичный вход клиента). Тип `VersionNumber` = `` `${number}.${number}.${number}` ``
  экспортируется из пакета: строка «Точка, v1.2.3» в проп не пройдёт. Чинится в одну строку:
  `<AppShell version="8.3.0" …>`, для входа `<LoginShell version="8.3.0" …>`, а свою строку
  версии у роли, в подвале панели и в шапке платформа удаляет.
- Перепись получила два вида: `версия_мимо_места` (видимый элемент с собственным текстом
  `vN.N.N` или «версия N.N.N» вне `[data-chip-version]`) и `версия_нет` (развёрнутая панель на
  широком экране без видимой строки версии, а также строка не той формы «Название, vN.N.N»).
  Selftest ловит номер у роли, в подвале панели и панель без строки и не ловит строку пакета,
  свёрнутую и телефонную панель, «v3 · изменён Иван», «справочник методологии 2.34».
- Тип-замок: `tests/components.test.tsx` входит в `npm run test:types`, `@ts-expect-error` на
  `AppShell` без `version` и с готовой строкой вместо номера действует, а не декорация.

## 0.9.6 — 24.09.2026

- Исправлено: `Card` больше не становится контролом оттого, что ему передали `as`. Метку
  `data-chip-control` и класс `chip-card--interactive` (рука, рамка при наведении) получают
  только `interactive`, теги `a`, `button`, `label`, `summary` и компонент (ссылка роутера).
  Раньше раздел `as="section"`, `article`, `li` и обёртка платформы `as ?? 'div'` выглядели
  нажимаемыми: так было на всех карточках Бренд-платформы и в шести разделах отчёта Точки.
- Исправлено: слот действия `Notice` сжимается и переносит кнопки внутри уведомления. Две
  кнопки на 360 при крупном тексте уезжали за экран (правый край 381–476 px).
- Перепись получила вид `ложный_контрол`: метка контрола пакета на элементе, который не
  нажимается. Законно, когда карточку почти целиком занимает её собственный контрол
  (пункт-`summary`). Selftest переписи теперь входит в проверки витрины.
- Паритет с Figma меряет габариты: состояние взаимодействия (наведение, нажатие, отключено,
  выбрано) не меняет размер варианта относительно «Обычного». Данные в
  `tokens/figma-наборы.json`, выгрузка `tokens/выгрузка-наборов-figma.js`, правка руками
  ловится контрольной суммой.
- Витрина: уведомление с двумя действиями; интерактивная карточка по образцу пакета
  (`role="button"`, `tabIndex`, обработчик).

## 0.9.5 — 24.09.2026

- Исправлено: в карточном режиме Table ячейка действий больше не наследует настольные
  `width: max-content` и `white-space: nowrap`. Ряд из трёх и более действий переносится
  внутри записи с gap 12 между рядами, страница на 360/390 остаётся по ширине экрана
  (в 0.9.4 документ расширялся до 440–475 px).
- Витрина получила запись с тремя действиями, а браузерный контракт меряет ширину
  документа, границы ячейки, перенос ряда и зазор между рядами на 360/390/1280.

## 0.9.4 — 24.09.2026

- Действия Table стоят одним рядом по правому краю; в карточках ряд переносится слева
  без пересечения мобильных зон 44. Кнопка и ссылка используют размер sm 32.
- Заголовок колонки действий скрыт визуально, но доступен скринридеру; шапка таблицы
  получила канонический фон `canvas`.
- Badge больше не переносит подпись, а пустое состояние Table вынесено из области
  горизонтальной прокрутки, выровнено слева и переносится в видимой ширине.
- Витрина и браузерный контракт измеряют ряды действий, зоны касания, Badge и длинное
  пустое сообщение на 360/390/1280.

## 0.9.3 — 24.09.2026

- Добавлен `Table` с обязательным выбором мобильного поведения: плоские записи-карточки
  с единственным нижним разделителем и подписью
  над значением или широкая таблица с прокруткой и тенями только при переполнении.
- Пустое состояние Table обязательно и сохраняет шапку; числовые колонки получают
  правый край и `tabular-nums`, строка-действие доступна с клавиатуры.
- `Avatar` вынесен из `UserBlock` в публичный API: размеры 24/32, картинка с запасными
  инициалами и детерминированная категория по имени.
- Добавлены восемь токенов категорий и `categoryColor`: прежние hex РО переводятся
  в ближайшие системные оттенки, незнакомые значения явно отмечаются как цвет из данных.
- Витрина и браузерный контракт измеряют обе мобильные таблицы, пустой список,
  фактическое переполнение и восемь различимых фонов Avatar на 360/390/1280.

## 0.9.2 — 24.09.2026

- У `Button` и `ButtonLink` варианта `link` убран горизонтальный внутренний
  отступ: текст ссылки совпадает с краем соседнего текста, а расстояние между
  ссылками задаёт контейнер.
- Фокусное кольцо осталось вынесенным наружу, мобильная зона касания — не меньше
  44 px; витрина и браузерный контракт проверяют выравнивание и непересечение зон.

## 0.9.1 — 24.09.2026

- На телефоне действия TopBar остаются справа в первой строке, пока помещаются;
  широкая группа естественно переносится ниже, не вытесняя меню и заголовок.
- `AppShell.breadcrumbs` и `TopBar.breadcrumbs` принимают динамические пункты
  `{ label, href? }`; последний пункт всегда отмечен как текущая страница.
- `TopBar.description` и `AppShell.description` дают одну строку контекста под
  единственным заголовком экрана и переносят её по словам на любой ширине.
- Добавлены `Field` со связанными подписью, подсказкой и ошибкой и составной
  `DateField` без системного `input[type=date]`: три части стоят в одной строке,
  месяцы записаны в родительном падеже, а сохранённый год вне диапазона не теряется.
- `Button` и `ButtonLink` получили loading без скачка ширины; `Chip` получил
  отдельный слот иконки 16 px.
- Витрина покрывает новые части на 360/390/768/1280/1440; браузерный контракт
  проверяет ширину loading-кнопок и отсутствие системного поля даты.

## 0.9.0 — 23.09.2026

- Все контролы пакета получают `data-chip-control`; тест перебирает экспортируемые
  компоненты и не пропускает интерактивный узел без метки.
- `AppShell` раскрывает группу при активности её корня и принимает независимый `title`.
- Добавлены `IconButton` со счётчиком, `ButtonLink` и интерактивный `Card.as`.
- В документном слое Button secondary, ghost и link используют роли документа.
- Hover работает только на устройствах с настоящим указателем и сохраняет выбранные
  состояния Chip, Tabs, NavItem, Switch и ListRow.
- Input получил `font` и `trailingAction`, Textarea — `font` и `resize`, Notice — `action`.
- Единый `gate/оболочка-канон.mjs` входит в tarball и читает платформенный конфиг через
  `--конфиг`; его selftest ломает каждое из 18 правил.

## 0.8.0 — 23.09.2026

- `NavItemConfig` поддерживает действия без маршрута через `id` и `onSelect`, счётчик
  очереди, отключённое состояние с причиной и явную активность.
- `AppShell.sidebarFooter` добавляет системную строку в подвал панели; свёрнутые пункты
  получают доступные подсказки, вынесенные в portal за пределы scroll-контейнера.
- Добавлен управляемый `Chip` с `aria-pressed`, счётчиком, предупреждающим тоном,
  disabled-состоянием и мобильной зоной касания 44.
- `ListRow` получил составной режим `children`: несколько частей остаются одной
  кнопкой-строкой с общей зоной 44 и фокусным кольцом.
- Витрина показывает новые пункты меню, строку подвала, все состояния Chip и составной
  ListRow; webcheck и перепись проходят семь страниц без ломающих и внесистемных значений.

## 0.7.1 — 23.09.2026

- `Input.align` поддерживает `start` и `end`; по умолчанию сохраняется `start`.
- `align="end"` выравнивает числа и суммы по логическому правому краю и включает
  `font-variant-numeric: tabular-nums` для одинаковой ширины цифр.
- Витрина и браузерный контракт проверяют вычисленные `text-align` и
  `font-variant-numeric`, а не только имя CSS-класса.

## 0.7.0 — 23.09.2026

- `AppShell` получил вложенные декларативные группы: главы, единственное раскрытое
  состояние, активный пункт внутри группы и прогресс `completed/total`.
- `FileField` поддерживает файл с сервера и действия «Скачать / Заменить / Удалить»,
  несколько файлов со списком удаления и аватар с круглым превью и клиентским кадрированием.
- `Modal.size` даёт системные ступени `sm=400`, `md=560`, `lg=768`;
  на телефоне все три занимают доступную ширину с полями.
- `Card` передаёт `ref`, получил `interactive` и пропускает свойства раскладки из
  `className`, сохраняя закрытыми фон, рамку, радиус, внутренние отступы и тень.
- `Input.trailingText` добавляет единицу справа. `Select`, как Input и Textarea,
  использует сенсорный кегль 16 на ширине до 768 px.
- Контейнеры и строки получили `min-width: 0`; атомарные контролы сохраняют целые слова,
  а `Button.fullWidth` выравнивает подпись по началу и прижимает правую иконку к краю.
- В пакете нет `overflow-wrap: anywhere`: содержимое использует `break-word`, подписи
  контролов — `normal`; длинные URL получают явные точки переноса.
- Витрина показывает все новые состояния. Браузерный контракт фиксирует Card
  `max-w-md = 448` и защищённый от `bg-red-500` фон; webcheck и перепись идут по семи страницам.

## 0.6.4 — 23.09.2026

- `overflow-wrap: anywhere` удалён из пакета целиком: он уменьшал min-content до одной
  буквы и схлопывал карточки и строки в гибкой раскладке платформ.
- Заголовки, описания, `ListRow`, `Tooltip` и `TopBar` используют `break-word`:
  обычные слова сохраняются целыми, а длинный URL не выходит за карточку.
- Подписи `Switch` и действия `FileField` используют `overflow-wrap: normal`.
- Витрина проверяет Card и ListRow в колонке 280 px; перепись измеряет
  360, 390, 1280 и 1440 px и требует ноль находок вида «разрыв».

## 0.6.3 — 23.09.2026

- Атомарные контролы `Button`, `Tabs.Tab`, `Badge`, `Checkbox`/`Radio` и `NavItem`
  больше не сжимаются уже самого длинного слова; перенос остаётся только по пробелам.
- `Button.align` поддерживает `center` и `start`. У `fullWidth` подпись по умолчанию
  занимает доступную ширину и выровнена по началу, а правая иконка прижата к краю.
- `Modal` при открытии фокусирует первый контрол содержимого раньше действий шапки
  и кнопки закрытия.
- Витрина содержит пять узких кнопок-вкладок и `fullWidth`-кнопку с обеими иконками;
  перепись проверяет отсутствие разрыва слов.

## 0.6.2 — 23.09.2026

- `Card.tone` даёт пять видов по данным: `neutral`, `accent`, `success`, `warning`,
  `danger`. Рамка и подложка берут только смысловые роли пакета.
- `Card.elevation` поддерживает `flat` и `raised`; по умолчанию `flat`,
  а `raised` использует `--chip-shadow-raised`.
- Витрина показывает все десять сочетаний тона и уровня.

## 0.6.1 — 23.09.2026

- Компоненты и контейнеры витрины сжимаются до 320 px: Card, Button,
  Checkbox/Radio, Switch, ListRow, Notice, FileField и ProgressBar не распирают экран.
- Шапка Card переносит слот действия; подписи Switch переносятся при
  увеличенном тексте; sm-поля на телефоне дают зону касания 44 px.
- Базовые стили фиксируют `text-size-adjust: 100%`, чтобы iOS не растил
  кегль платформы самостоятельно.
- Skip-link AppShell при фокусе входит в поток и сдвигает содержимое, не перекрывая
  TopBar; длинный заголовок TopBar переносится, а панель растёт по высоте.
- `Input` получил `leadingIcon`; при `type="password"` пакет сам добавляет кнопку
  «Показать/скрыть пароль» с зоной 44 px. `Checkbox.indeterminate` показывает
  частичный выбор и отдаёт `aria-checked="mixed"`.
- `npm run check` прогоняет `webcheck.py --quick` по всем пяти страницам
  витрины и падает при любой ломающей находке.

## 0.6.0 — 23.09.2026

- Добавлены структурный `ListRow`, portal-меню `Dropdown`, токенный `ProgressBar`,
  прокручиваемые `Tabs` и доступный `Tooltip` по сильнейшему донору Бренд-платформы.
- `Tabs` поддерживает стрелки, Home/End, показывает продолжение ряда и доводит активную
  вкладку в видимую область; `Dropdown` управляет фокусом и закрывается по Escape.
- `Card` получил правый слот действия и явные варианты `padding`, `surface`, `radius`;
  `className` оставлен только для раскладки, пакетный вид сильнее Tailwind utilities.
- `Modal` получил слот `headerActions`; лайтбокс галереи не менялся.
- `Button` получил правый слот `iconRight` независимо от левой иконки.
- `Button` больше не обрезает подпись многоточием: при увеличенном системном тексте
  подпись переносится, а контрол растёт от своей минимальной высоты.
- Витрина показывает все варианты и состояния новых компонентов на пяти страницах.
- Новые токены не понадобились: использованы значения выгрузки Figma 0.4.1.

## 0.5.0 — 23.09.2026

- Добавлены `Checkbox` и `Radio`: вид 16 px, а подпись и невидимая зона дают
  полные 44 px для пальца на любой ширине.
- Добавлен `Switch` по донору Точки: двухсегментный взаимоисключающий выбор, нейтральное состояние, клавиши стрелок, Home и End.
- Добавлен `Modal`: portal, focus trap, возврат фокуса, блокировка прокрутки,
  закрытие по кнопке, Escape и фону.
- Добавлен `Notice` в пяти смысловых тонах.
- Добавлен `FileField` со скрытым системным полем, drag-and-drop, выбранным файлом,
  ошибкой и disabled-состоянием.
- Все новые примитивы закрыты от `className` и `style`; витрина показывает их состояния.
- Новые токены не понадобились: компоненты собраны из словаря Figma 0.4.1.

## 0.4.1 — 23.09.2026

- `Input` и `Textarea` на ширине до 768 px используют компонентный токен
  `--chip-input-font-size-touch: 16px`; широкие размеры md/sm не изменились.
- Сенсорный кегль не выводится в тему Tailwind как текстовая ступень.
- `DocumentSurface` больше не принимает `className`: документный холст нельзя
  переопределить снаружи, раскладка размещается внутри компонента.
- `Card` получил слоты `title` и `description` с закрытой типографикой пакета.

## 0.4.0 — 23.09.2026

- Figma стала источником 222 переменных, включая многорежимную
  коллекцию «06 Документ»: «Широкий» в `:root`, «Узкий» до 1023,98 px.
- Добавлены роли `--color-doc-*`, семь пар `--text-doc-*`,
  `--font-doc-display`, `--shadow-doc-accent` и `--tracking-overline` для Tailwind 4.
- Oswald 500/600/700 входит в tarball с кириллицей и латиницей; все шесть
  бинарников проверяются по SHA-256.
- Печать фиксирует широкую шкалу, а витрина показывает тёмный холст,
  все ступени и сигналы акцента, успеха и опасности.
- FLOAT из Figma округляется до четырёх знаков и в экспорте, и в генераторе.
- `DocumentSurface` стал единственной точкой входа в документный вид: он ставит
  `data-chip-doc`, холст, основной цвет и базовую типографическую ступень.

## 0.3.2 — 23.09.2026

- Кнопка «Назад» в `TopBar` на телефоне показывает только стрелку,
  сохраняет зону касания 44 и полную подпись в `aria-label`.
- Мобильный заголовок сжимается отдельно от кнопки; подписи кнопок
  витрины не переносятся и не обрезаются на 390 и 1440.

## 0.3.1 — 23.09.2026

- На телефонной ширине интерактивные элементы пакета принимают касание в 21 пикселе
  от центра по всем четырём сторонам без изменения видимого размера.
- Подпись `Button` не переносится; при нехватке ширины она сокращается многоточием.
- Плотный ряд кнопок витрины использует телефонный зазор 16, поэтому расширенные зоны
  соседних строк не перекрываются.

## 0.3.0 — 23.09.2026

- Figma стала буквальным источником 171 токена; CSS и тема Tailwind генерируются.
- `LoginShell` принимает только структурное обещание и сам задаёт его вид.
- Добавлены оболочка, декларативное меню, верхняя панель, пользовательский блок,
  пустое состояние, уведомления и компоненты типового экрана.
- В `npm run check` входят живая перепись витрины на 390/1440 и перепись собранного CSS.

### Миграция местных токенов и классов

В колонке «пакет» первое имя — CSS-переменная, второе (если указано) — имя темы Tailwind 4.
Несколько старых имён в одной строке заменяются одной смысловой ролью пакета.

| Платформа | Старое местное имя токена / класса | Пакет 0.3 |
|---|---|---|
| Работа над ошибками | `--color-surface-canvas`, `--color-border-faint` | `--chip-color-canvas` / `--color-canvas` |
| Работа над ошибками | `--color-surface-raised` | `--chip-color-surface` / `--color-surface` |
| Работа над ошибками | `--color-surface-inverse`, `--color-overlay` | `--chip-color-inverse`, `--chip-color-overlay` |
| Работа над ошибками | `--color-surface-inverse-soft` | `--chip-color-inverse-hover` |
| Работа над ошибками | `--color-border-subtle`, `--color-track`, `--color-fg-decor` | `--chip-color-border` / `--color-border` |
| Работа над ошибками | `--color-fg-faint`, `--color-stone-400` | `--chip-color-fg-disabled` / `--color-fg-disabled` |
| Работа над ошибками | `--color-on-dark` | `--chip-color-on-inverse` / `--color-on-inverse` |
| Работа над ошибками | `--color-on-dark-muted`, `--color-on-dark-secondary`, `--color-on-dark-company`, `--color-on-dark-subtle`, `--color-on-dark-faint-strong`, `--color-on-dark-faint` | `--chip-color-on-inverse-muted` / `--color-on-inverse-muted` |
| Работа над ошибками | `--color-on-dark-ghost`, `--color-border-inverse`, `--color-border-inverse-strong` | `--chip-color-inverse-divider` / `--color-inverse-divider` |
| Работа над ошибками | `--color-surface-inverse-hover` | `--chip-color-hover` / `--color-hover` |
| Работа над ошибками | `--color-surface-inverse-active` | `--chip-color-pressed` / `--color-pressed` |
| Работа над ошибками | `--color-accent-solid`, `--color-accent-public` | `--chip-color-accent` / `--color-accent` |
| Работа над ошибками | `--color-accent-strong` | `--chip-color-accent-hover` / `--color-accent-hover` |
| Работа над ошибками | `--color-accent-pressed` | `--chip-color-accent-active` / `--color-accent-active` |
| Работа над ошибками | `--color-accent-ring` | `--chip-color-accent-focus` / `--color-accent-focus` |
| Работа над ошибками | `--color-accent-subtle-alt` | `--chip-color-accent-subtle-hover` / `--color-accent-subtle-hover` |
| Работа над ошибками | `--color-accent-muted-alt` | `--chip-color-accent-border` / `--color-accent-border` |
| Работа над ошибками | `--color-accent-fg-alt` | `--chip-color-accent-fg-deep` / `--color-accent-fg-deep` |
| Работа над ошибками | `--color-danger-inverse-subtle` | `--chip-color-danger-subtle` / `--color-danger-subtle` |
| Работа над ошибками | `--color-danger-muted`, `--color-success-muted`, `--color-warning-muted`, `--color-info-muted` | `--chip-color-danger-border`, `--chip-color-success-border`, `--chip-color-warning-border`, `--chip-color-info-border` |
| Работа над ошибками | `--color-violet-500` | удалить: назначить роль `--chip-color-accent`, `--chip-color-info`, `--chip-color-success`, `--chip-color-warning` или `--chip-color-danger` |
| Работа над ошибками | `--color-white` | по роли: `--chip-color-surface`, `--chip-color-on-inverse` или `--chip-color-on-accent` |
| Работа над ошибками | `--shadow-raised`, `--shadow-float` | `--chip-shadow-raised` / `--shadow-raised` |
| Работа над ошибками | `--shadow-overlay` | `--chip-shadow-overlay` / `--shadow-overlay` |
| Работа над ошибками | `--text-caption`, `--text-xs` и их `--line-height` / `text-xs` | `--chip-text-micro`, `--chip-text-micro--line-height` / `text-micro` |
| Работа над ошибками | `--text-dense`, `--text-sm` и их `--line-height` / `text-sm` | `--chip-text-body`, `--chip-text-body--line-height` / `text-body` |
| Работа над ошибками | `--text-body--line-height` | `--chip-text-body--line-height` |
| Работа над ошибками | `--text-h3` и `--line-height` | `--chip-text-title`, `--chip-text-title--line-height` / `text-title` |
| Работа над ошибками | `--text-h2`, `--text-2xl` и их `--line-height` | `--chip-text-section`, `--chip-text-section--line-height` / `text-section` |
| Работа над ошибками | `--text-h1` и `--line-height` | `--chip-text-page`, `--chip-text-page--line-height` / `text-page` |
| Работа над ошибками | `--tracking-wide`, `--tracking-wider`, `--leading-tight`, `--leading-snug`, `--leading-relaxed` | убрать из платформы: межстрочное задаёт `--chip-text-<роль>--line-height`; надзаголовок — `--chip-tracking-overline` |
| Работа над ошибками | `--tracking-overline` | `--chip-tracking-overline` / `--tracking-overline` |
| Работа над ошибками | `--radius-lg`, `--radius-xl`, `--radius-nested` | `--chip-radius-block` / `--radius-block` |
| Работа над ошибками | `--radius-2xl` | `--chip-radius-card` / `--radius-card` |
| Точка | `--color-neutral-50`, `100`, `200`, `300`, `500`, `600`, `700`, `900`; `--color-neutral-white` | соответствующие `--chip-color-ink-50…900`, `--chip-color-ink-0` |
| Точка | `--color-dark-900`, `--color-dark-800`, `--color-dark-700` | `--chip-color-inverse`, `--chip-color-inverse-hover`, `--chip-color-pressed` |
| Точка | `--color-dark-600`, `--color-dark-500`, `--color-dark-text-2`, `--color-dark-text-3`, `--color-dark-gray`, `--color-dark-gray-2` | по роли: `--chip-color-border-strong`, `--chip-color-fg-muted`, `--chip-color-fg-subtle`, `--chip-color-on-inverse-muted` |
| Точка | `--color-sunken` | `--chip-color-surface-sunken` / `--color-surface-sunken` |
| Точка | `--color-fg-secondary`, `--color-fg-secondary-strong`, `--color-fg-quiet`, `--color-fg-secondary-legacy` | `--chip-color-fg-muted`, `--chip-color-fg`, `--chip-color-fg-subtle` |
| Точка | `--color-fg-on-inverse`, `--color-fg-on-inverse-2`, `--color-fg-on-inverse-3` | `--chip-color-on-inverse`, `--chip-color-on-inverse-muted` |
| Точка | `--color-fg-on-accent` | `--chip-color-on-accent` / `--color-on-accent` |
| Точка | `--color-border-on-inverse` | `--chip-color-inverse-divider` / `--color-inverse-divider` |
| Точка | `--color-border-default`, `--color-border-subtle` | `--chip-color-border`, `--chip-color-border-strong` |
| Точка | `--color-accent-mark`, `--color-accent-fill` | `--chip-color-accent` / `--color-accent` |
| Точка | `--color-accent-fill-hover`, `--color-accent-fill-deep` | `--chip-color-accent-hover`, `--chip-color-accent-active` |
| Точка | `--color-accent-text`, `--color-accent-text-on-subtle` | `--chip-color-accent-fg`, `--chip-color-accent-fg-deep` |
| Точка | `--color-accent-divider`, `--color-accent-plate`, `--color-accent-on-inverse` | `--chip-color-accent-muted`, `--chip-color-accent-subtle-hover`, `--chip-color-accent-on-dark` |
| Точка | `--color-success-50`, `400`, `700`; `--color-success-text`, `solid`, `mark` | `--chip-color-success-subtle`, `--chip-color-success`, `--chip-color-success-fg` |
| Точка | `--color-warning-50`, `100`, `500`, `700`; `--color-warning-text`, `solid`, `mark` | `--chip-color-warning-subtle`, `--chip-color-warning`, `--chip-color-warning-fg` |
| Точка | `--color-danger-50`, `100`, `400`, `500`, `600`, `700`; `--color-danger-text`, `solid`, `mark`; `--color-danger-text-legacy`, `--color-doc-red` | `--chip-color-danger-subtle`, `--chip-color-danger`, `--chip-color-danger-fg`, `--chip-color-danger-fg-hover` |
| Точка | `--color-info-50`, `500`, `700`; `--color-info-text`, `solid`, `mark` | `--chip-color-info-subtle`, `--chip-color-info`, `--chip-color-info-fg` |
| Точка | `--color-doc-canvas`, `--color-doc-surface`, `--color-doc-surface-2`, `--color-doc-border`, `--color-doc-border-strong` | `--chip-color-inverse`, `--chip-color-inverse-hover`, `--chip-color-inverse-divider`, `--chip-color-border-strong` |
| Точка | `--color-doc-fg`, `--color-doc-body`, `--color-doc-fg-2`, `--color-doc-fg-3`, `--color-doc-formula` | `--chip-color-on-inverse`, `--chip-color-on-inverse-muted` |
| Точка | `--color-doc-accent`, `--color-doc-accent-hover` | `--chip-color-accent-on-dark`, `--chip-color-accent-on-dark-hover` |
| Точка | `--color-doc-success`, `--color-doc-danger` | `--chip-color-success`, `--chip-color-danger` |
| Точка | `--color-white`, `--color-neutral-white` | по роли: `--chip-color-surface`, `--chip-color-on-inverse` или `--chip-color-on-accent` |
| Точка | `--color-indigo-600`, `--color-gray-500` | удалить: назначить смысловую роль `--chip-color-info` или `--chip-color-fg-subtle` |
| Точка | `--color-primary-300` | `--chip-color-accent-focus` / `--color-accent-focus` |
| Точка | `--shadow-accent` | `--chip-shadow-raised` / `--shadow-raised` |
| Точка | `--text-ui-xs`, `--text-xs`, `--text-doc-xs` и их `--line-height` / `text-xs` | `--chip-text-micro`, `--chip-text-micro--line-height` / `text-micro` |
| Точка | `--text-ui-sm`, `--text-sm`, `--text-doc-sm` и их `--line-height` / `text-sm` | `--chip-text-body`, `--chip-text-body--line-height` / `text-body` |
| Точка | `--text-ui-base`, `--text-base`, `--text-doc-base` и их `--line-height` / `text-base` | `--chip-text-body-lg`, `--chip-text-body-lg--line-height` / `text-body-lg` |
| Точка | `--text-ui-lg`, `--text-lg`, `--text-doc-lg` и их `--line-height` / `text-lg` | `--chip-text-title`, `--chip-text-title--line-height` / `text-title` |
| Точка | `--text-ui-xl`, `--text-xl`, `--text-doc-xl` и их `--line-height` / `text-xl` | `--chip-text-section`, `--chip-text-section--line-height` / `text-section` |
| Точка | `--text-ui-2xl`, `--text-2xl`, `--text-3xl`, `--text-doc-2xl` и их `--line-height` | `--chip-text-page`, `--chip-text-page--line-height` / `text-page` |
| Точка | `--text-5xl`, `--text-6xl`, `--text-doc-display` и их `--line-height` | `--chip-text-display`, `--chip-text-display--line-height` / `text-display` |
| Точка | `--tracking-tight`, `--tracking-wide`, `--tracking-widest`, `--leading-tight`, `--leading-snug`, `--leading-relaxed` | убрать: типографические роли пакета задают межстрочное; надзаголовок — `--chip-tracking-overline` |
| Точка | `--radius-xs`, `--radius-sm`, `--radius-md` | `--chip-radius-chip`, `--chip-radius-field`, `--chip-radius-block` |
| Точка | `--radius-lg`, `--radius-xl`, `--radius-2xl`, `--radius-3xl` | `--chip-radius-field`, `--chip-radius-block`, `--chip-radius-card` |
| Точка | `--radius-pill` | `--chip-radius-pill` / `--radius-pill` |
| Бренд-платформа | `--color-red-600`, `--color-green-200` | `--chip-color-danger-fg`, `--chip-color-success-border` |
| Бренд-платформа | `--color-black`, `--color-white` | по роли: `--chip-color-inverse`, `--chip-color-fg`, `--chip-color-surface`, `--chip-color-on-inverse`, `--chip-color-on-accent` |
| Бренд-платформа | местные `--text-micro`, `body`, `body-lg`, `title`, `section`, `page`, `display` и их `--line-height` | одноимённые `--chip-text-*` и `--chip-text-*--line-height` |
| Бренд-платформа | `--text-hero`, `--text-hero-xl` и их `--line-height` | `--chip-text-display`, `--chip-text-display--line-height` / `text-display` |
| Бренд-платформа | `--tracking-tight`, `--tracking-wide`, `--leading-tight`, `--leading-snug`, `--leading-relaxed` | убрать; надзаголовок — `--chip-tracking-overline` |
| Бренд-платформа | `--radius-pill` | `--chip-radius-pill` / `--radius-pill` |
| UX Test Hub | местные `--text-micro`, `body`, `body-lg`, `title`, `page` и их `--line-height` | одноимённые `--chip-text-*` и `--chip-text-*--line-height` |
| UX Test Hub | `--text-hero` и `--line-height` | `--chip-text-display`, `--chip-text-display--line-height` / `text-display` |
| UX Test Hub | `--leading-tight` | убрать: межстрочное задают роли пакета |
| UX Test Hub | `--radius-pill` | `--chip-radius-pill` / `--radius-pill` |
| UX Test Hub | `--shadow-raised`, `--shadow-overlay` | одноимённые `--chip-shadow-*` / `--shadow-*` |
| Маркетинговая тактика · Эстрим Фест | `--color-brand`, `--color-brand-dark` | `--chip-color-accent`, `--chip-color-accent-hover` |
| Маркетинговая тактика · Эстрим Фест | `--color-surface-2`, `--color-surface-3`, `--color-text`, `--color-text-dim`, `--color-black`, `--color-white` | `--chip-color-inverse`, `--chip-color-inverse-hover`, `--chip-color-on-inverse`, `--chip-color-on-inverse-muted` |
| Маркетинговая тактика · Эстрим Фест | `--text-xs`, `sm`, `base`, `lg`, `xl`, `2xl`, `3xl` и их `--line-height` | по роли `--chip-text-micro`, `body`, `body-lg`, `title`, `section`, `page`, `display` и парное `--line-height` |
| Маркетинговая тактика · Эстрим Фест | `--tracking-wider`, `--tracking-widest`, `--leading-tight`, `--leading-relaxed` | убрать; надзаголовок — `--chip-tracking-overline` |
| Маркетинговая тактика · Эстрим Фест | `--radius-lg`, `--radius-xl`, `--radius-2xl` | `--chip-radius-field`, `--chip-radius-block`, `--chip-radius-card` |
| KIYA | `--color-accent-strong` | `--chip-color-accent-hover` / `--color-accent-hover` |
| Работа над ошибками | `--text-xs--line-height`, `--text-caption--line-height` | `--chip-text-micro--line-height` |
| Работа над ошибками | `--text-sm--line-height`, `--text-dense--line-height` | `--chip-text-body--line-height` |
| Работа над ошибками | `--text-h3--line-height` | `--chip-text-title--line-height` |
| Работа над ошибками | `--text-h2--line-height`, `--text-2xl--line-height` | `--chip-text-section--line-height` |
| Работа над ошибками | `--text-h1--line-height` | `--chip-text-page--line-height` |
| Точка | `--color-neutral-100`, `--color-neutral-200`, `--color-neutral-300`, `--color-neutral-500`, `--color-neutral-600`, `--color-neutral-700`, `--color-neutral-900` | соответствующие `--chip-color-ink-100…900` |
| Точка | `--color-success-400`, `--color-success-700`, `--color-success-solid`, `--color-success-mark` | `--chip-color-success`, `--chip-color-success-fg` |
| Точка | `--color-warning-100`, `--color-warning-500`, `--color-warning-700`, `--color-warning-solid`, `--color-warning-mark` | `--chip-color-warning-subtle`, `--chip-color-warning`, `--chip-color-warning-fg` |
| Точка | `--color-danger-100`, `--color-danger-400`, `--color-danger-500`, `--color-danger-600`, `--color-danger-700`, `--color-danger-solid`, `--color-danger-mark` | `--chip-color-danger-subtle`, `--chip-color-danger`, `--chip-color-danger-fg`, `--chip-color-danger-fg-hover` |
| Точка | `--color-info-500`, `--color-info-700`, `--color-info-solid`, `--color-info-mark` | `--chip-color-info`, `--chip-color-info-fg` |
| Точка | `--text-xs--line-height`, `--text-ui-xs--line-height`, `--text-doc-xs--line-height` | `--chip-text-micro--line-height` |
| Точка | `--text-sm--line-height`, `--text-ui-sm--line-height`, `--text-doc-sm--line-height` | `--chip-text-body--line-height` |
| Точка | `--text-base--line-height`, `--text-ui-base--line-height`, `--text-doc-base--line-height` | `--chip-text-body-lg--line-height` |
| Точка | `--text-lg--line-height`, `--text-ui-lg--line-height`, `--text-doc-lg--line-height` | `--chip-text-title--line-height` |
| Точка | `--text-xl--line-height`, `--text-ui-xl--line-height`, `--text-doc-xl--line-height` | `--chip-text-section--line-height` |
| Точка | `--text-2xl--line-height`, `--text-3xl--line-height`, `--text-ui-2xl--line-height`, `--text-doc-2xl--line-height` | `--chip-text-page--line-height` |
| Точка | `--text-5xl--line-height`, `--text-6xl--line-height`, `--text-doc-display--line-height` | `--chip-text-display--line-height` |
| Бренд-платформа | `--text-micro--line-height`, `--text-body--line-height`, `--text-body-lg--line-height`, `--text-title--line-height`, `--text-section--line-height`, `--text-page--line-height`, `--text-display--line-height` | соответствующие `--chip-text-<роль>--line-height` |
| Бренд-платформа | `--text-display`, `--text-hero--line-height`, `--text-hero-xl--line-height` | `--chip-text-display`, `--chip-text-display--line-height` |
| UX Test Hub | `--text-micro--line-height`, `--text-body--line-height`, `--text-body-lg--line-height`, `--text-title--line-height`, `--text-page--line-height`, `--text-hero--line-height` | соответствующие `--chip-text-<роль>--line-height`; hero → display |
| Маркетинговая тактика · Эстрим Фест | `--text-xs--line-height`, `--text-sm--line-height`, `--text-base--line-height`, `--text-lg--line-height`, `--text-xl--line-height`, `--text-2xl--line-height`, `--text-3xl--line-height` | по роли соответствующее `--chip-text-<роль>--line-height` |

### Миграция местных компонентов

| Платформа | Местный компонент | Компонент пакета 0.3 |
|---|---|---|
| Работа над ошибками | `layout/AppLayout.tsx`, `layout/Sidebar.tsx` | `AppShell` + декларативный `NavItemConfig[]` |
| Работа над ошибками | `sprint/SprintHeader.tsx` | `TopBar` |
| Работа над ошибками | `ui/LogoMark.tsx` | `BrandMark` / `BrandLogo` |
| Работа над ошибками | `ui/button.tsx`, `*ExportButton`, `TelegramLinkButton` | `Button` |
| Работа над ошибками | `ui/input.tsx` | `Input` / `Textarea` |
| Работа над ошибками | `sprint/SourceSelector.tsx` | `Select` |
| Работа над ошибками | `ui/EmptyState.tsx` | `EmptyState` |
| Работа над ошибками | `ui/card.tsx`, видовые `*Card.tsx` | `Card` как внешний контейнер; продуктовая логика остаётся платформе |
| Работа над ошибками | `ui/badge.tsx`, `status-badge.tsx`, `*Badge.tsx`, `*Pill.tsx` | `Badge` |
| Работа над ошибками | `ui/avatar.tsx` и местный блок пользователя | `UserBlock` |
| Работа над ошибками | `<Toaster>` в `App.tsx` | `Toaster` внутри `AppShell`; вторую точку удалить |
| Точка | `Layout.tsx`, `Sidebar.tsx`, `DevSidebarProbePage.tsx` | `AppShell` + `NavItemConfig[]` |
| Точка | `ui/HeaderBar.tsx` | `TopBar` |
| Точка | `Brand.tsx` | `BrandMark` / `BrandLogo` |
| Точка | `ui/Button.tsx`, `ui/IconButton.tsx`, `ReferenceRequestButton.tsx` | `Button` |
| Точка | `ui/Input.tsx`, `brief/*Input.tsx` | `Input` / `Textarea`; составная логика brief остаётся платформе |
| Точка | `ui/Select.tsx`, `AnswerStateSelector.tsx` | `Select` |
| Точка | `ui/EmptyState.tsx` | `EmptyState` |
| Точка | `ui/Card.tsx`, `ui/StateCard.tsx`, `brief/IntroCard.tsx` | `Card` |
| Точка | `ui/Badge.tsx`, `ui/Chip.tsx`, `ui/PillLink.tsx`, `StaleBadge.tsx` | `Badge` |
| Точка | `<Toaster>` в `App.tsx` | `Toaster` внутри `AppShell`; вторую точку удалить |
| Бренд-платформа | `Layout.tsx`, `Sidebar.tsx` | `AppShell` + `NavItemConfig[]` |
| Бренд-платформа | `ui/Breadcrumbs.tsx` | крошки `TopBar` из того же массива меню |
| Бренд-платформа | `Brand.tsx` | `BrandMark` / `BrandLogo` |
| Бренд-платформа | `ui/Button.tsx`, `ui/ExampleButton.tsx` | `Button` |
| Бренд-платформа | `ui/Input.tsx` | `Input` / `Textarea` |
| Бренд-платформа | `ui/Select.tsx` | `Select` |
| Бренд-платформа | `ui/EmptyState.tsx`, `wizard/EmptyDraftState.tsx` | `EmptyState` |
| Бренд-платформа | `ui/Card.tsx`, `ProjectFinishedCard.tsx` | `Card` |
| Бренд-платформа | `ui/Badge.tsx`, `ui/Chip.tsx`, `*Badge.tsx`, `TimeSavedChip.tsx` | `Badge` |
| Бренд-платформа | `ui/Avatar.tsx` и местный блок пользователя | `UserBlock` |
| Бренд-платформа | `<Toaster>` в `Layout.tsx` | `Toaster` внутри `AppShell`; вторую точку удалить |
| UX Test Hub | `Layout.tsx` | `AppShell`, `TopBar`, `UserBlock` и `NavItemConfig[]` |
| UX Test Hub | `Brand.tsx` | `BrandMark` / `BrandLogo` |
