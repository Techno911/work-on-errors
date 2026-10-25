# Разбор снимков долга · 14.09.2026

Исходная редакция: e1aed2e, ветка ro-ostatok/debts, дерево /tmp/ро-долги.

## Белый текст

Снимок: 40 → 0. Все 40 стали законными по фактической заливке; настоящий долг среди них: 0; ошибки замера среди этих 40: 0. Снимок удалён осознанно, --refresh не использовался. Дополнительно старый замок находил 41-е место в components/ui/badge.tsx:29 (solid/accent), которое тоже законно: #B45309, 5,02. Именно оно роняло сборку сверх снимка.

Новый замок читает index.css, считает sRGB-контраст с порогом 4,5 без округления перед сравнением, разбирает JSX, cn и альтернативные ветки общим AST-движком. Имя роли не определяет вердикт. Неизвестный формат измеряемого цвета останавливает проверку вместо молчаливого пропуска.

| № | Место в исходной редакции (frontend/src/) | Заливка и контраст белого | Вердикт |
|---|---|---|---|
| 1 | components/ErrorBoundary.tsx:51 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 2 | components/crm/CrmConnectWizard.tsx:244 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 3 | components/dashboard/CrmHintCard.tsx:98 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 4 | components/dashboard/RopBonusProposalCard.tsx:84 | accent-solid: #B45309, 5.02; accent-public: #B45309, 5.02 | законно |
| 5 | components/gamification/GamificationSettingsPanel.tsx:62 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 6 | components/layout/Sidebar.tsx:180 | accent-solid: #B45309, 5.02 | законно |
| 7 | components/notifications/NotificationBell.tsx:123 | accent-solid: #B45309, 5.02 | законно |
| 8 | components/playbook/PlaybookCandidateCard.tsx:79 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 9 | components/playbook/PlaybookCardItem.tsx:92 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 10 | components/playbook/PlaybookConfirmDialog.tsx:96 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 11 | components/playbook/PlaybookManualCardDialog.tsx:83 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 12 | components/settings/CrmIntegrationSettings.tsx:497 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 13 | components/settings/CrmIntegrationSettings.tsx:527 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 14 | components/settings/TelegramLinkButton.tsx:58 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 15 | components/sprint/CrmCallPicker.tsx:106 | accent-solid: #B45309, 5.02 | законно |
| 16 | components/sprint/ReviewerForm.tsx:246 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 17 | components/sprint/ReviewerForm.tsx:334 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 18 | components/sprint/SourceSelector.tsx:36 | accent-solid: #B45309, 5.02 | законно |
| 19 | components/sprint/TranscriptionStatusBadge.tsx:196 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 20 | components/sprint/TranscriptionStatusBadge.tsx:291 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 21 | components/ui/button.tsx:10 | accent-strong: #8F4207, 7.12; accent-pressed: #773706, 9.00 | законно |
| 22 | pages/AttestationReviewPage.tsx:135 | accent-solid: #B45309, 5.02 | законно |
| 23 | pages/InvitePage.tsx:153 | accent-solid: #B45309, 5.02; accent-public: #B45309, 5.02 | законно |
| 24 | pages/OfferPage.tsx:154 | accent-solid: #B45309, 5.02; accent-public: #B45309, 5.02 | законно |
| 25 | pages/OfferPage.tsx:171 | accent-solid: #B45309, 5.02; accent-public: #B45309, 5.02 | законно |
| 26 | pages/RopBonusOfferPage.tsx:141 | accent-solid: #B45309, 5.02; accent-public: #B45309, 5.02 | законно |
| 27 | pages/RopBonusOfferPage.tsx:161 | accent-solid: #B45309, 5.02; accent-public: #B45309, 5.02 | законно |
| 28 | pages/SettingsPage.tsx:612 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 29 | pages/SettingsPage.tsx:686 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 30 | pages/SettingsPage.tsx:801 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 31 | pages/SettingsPage.tsx:839 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 32 | pages/SettingsPage.tsx:1053 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 33 | pages/SettingsPage.tsx:1473 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 34 | pages/SettingsPage.tsx:1517 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 35 | pages/SettingsPage.tsx:1539 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 36 | pages/SettingsPage.tsx:1666 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 37 | pages/SettingsPage.tsx:1719 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 38 | pages/SettingsPage.tsx:1796 | accent-solid: #B45309, 5.02; accent-strong: #8F4207, 7.12 | законно |
| 39 | pages/SettingsPage.tsx:2097 | accent-solid: #B45309, 5.02; accent-public: #B45309, 5.02 | законно |
| 40 | pages/admin/CompanyDetailPage.tsx:1471 | accent-solid: #B45309, 5.02 | законно |

### Исправленная заливка

За пределами старого снимка AST нашёл кнопку «Отправить на ревью»: старый замок не соединял аргументы cn на разных строках.

| Место | Было | Стало | Белый до | Белый после |
|---|---|---|---|---|
| components/sprint/SelfReviewForm.tsx:285 | success, #22C55E | success-fg, #15803D | 2,28 | 5,02 |

Число после пересчитано по CSS: комментарий роли success-fg в index.css содержит устаревшие 4,72, реальный расчёт даёт 5,0155974781. Текст и hover-цвет не менялись.

Граница проверки: статически вычислимые сочетания классов. Она не объявляет проверенными цвета из пользовательских данных, наследование фона через компоненты и инлайновый background, который перекрывает обычный класс. В частности ErrorFrequencyChart использует row.color; его нельзя измерить по роли из index.css. Неактивные ветки кнопок с disabled и cursor-not-allowed исключены, как неактивные контролы в существующем no-faint-as-text; это не допуск для активной кнопки.

## Фокус

Снимок: 92 → 0. Исправлены 84 локальных кольца; сохранены 8 постоянных признаков состояния, которые старый замок ошибочно называл фокусом. Удалены также связанные ширины/отступы локальных focus-колец и подавление обводки в затронутых строковых рецептах. Общая обводка уже включена в index.css: 2px, отступ 2px, #773706; включать вторую не нужно. Новый замок запрещает локальные focus-кольца, в том числе одну ширину без цвета, и подавление outline в focus-состоянии; сохранность общего правила проверяется при запуске.

Восемь сохранённых мест: три выбранных пресета/провайдера, три плашки ошибки (две в RopBonusSettings на тех же строках, где были настоящие focus-кольца), две подсветки секции SettingsPage. Счёт ведётся по отдельному классу, не по строке.

| Место до правки (frontend/src/) | Старый класс | Решение |
|---|---|---|
| components/admin/CreateCompanyModal.tsx:78 | focus:ring-accent-ring | удалено, общая обводка |
| components/admin/CreateCompanyModal.tsx:115 | focus:ring-accent-ring | удалено, общая обводка |
| components/admin/CreateCompanyModal.tsx:137 | focus:ring-accent-ring | удалено, общая обводка |
| components/admin/NormPresetPicker.tsx:84 | ring-accent | сохранено: признак состояния, ошибка замера |
| components/analytics/ErrorFrequencyChart.tsx:100 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/analytics/TagManager.tsx:168 | focus:ring-accent-ring | удалено, общая обводка |
| components/analytics/TagManager.tsx:176 | focus:ring-accent-ring | удалено, общая обводка |
| components/attestation/GenerateTestDialog.tsx:61 | focus:ring-accent-ring | удалено, общая обводка |
| components/attestation/GenerateTestDialog.tsx:74 | focus:ring-accent-ring | удалено, общая обводка |
| components/crm/CrmConnectWizard.tsx:98 | ring-accent | сохранено: признак состояния, ошибка замера |
| components/crm/CrmConnectWizard.tsx:144 | focus:ring-accent-ring | удалено, общая обводка |
| components/crm/CrmConnectWizard.tsx:220 | focus:ring-accent-ring | удалено, общая обводка |
| components/crm/CrmConnectWizard.tsx:235 | focus:ring-accent-ring | удалено, общая обводка |
| components/dashboard/CrmHintCard.tsx:65 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/dashboard/CrmHintCard.tsx:98 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/dashboard/CrmHintCard.tsx:112 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/gamification/GamificationSettingsPanel.tsx:95 | focus:ring-accent-ring | удалено, общая обводка |
| components/gamification/GamificationSettingsPanel.tsx:124 | focus:ring-accent-ring | удалено, общая обводка |
| components/playbook/PlaybookCardItem.tsx:83 | focus:ring-accent-ring | удалено, общая обводка |
| components/playbook/PlaybookConfirmDialog.tsx:66 | focus:ring-accent-ring | удалено, общая обводка |
| components/playbook/PlaybookConfirmDialog.tsx:84 | focus:ring-accent-ring | удалено, общая обводка |
| components/playbook/PlaybookDismissDialog.tsx:71 | focus:ring-accent-ring | удалено, общая обводка |
| components/playbook/PlaybookManualCardDialog.tsx:62 | focus:ring-accent-ring | удалено, общая обводка |
| components/playbook/PlaybookManualCardDialog.tsx:73 | focus:ring-accent-ring | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:96 | focus-visible:ring-accent | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:123 | focus:ring-accent-ring | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:134 | focus:ring-accent-ring | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:158 | ring-danger-muted | сохранено: признак состояния, ошибка замера |
| components/settings/RopBonusSettings.tsx:158 | focus:ring-danger | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:159 | focus:ring-accent-ring | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:173 | ring-danger-muted | сохранено: признак состояния, ошибка замера |
| components/settings/RopBonusSettings.tsx:173 | focus:ring-danger | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:174 | focus:ring-accent-ring | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:242 | focus:ring-accent-ring | удалено, общая обводка |
| components/settings/RopBonusSettings.tsx:264 | focus-visible:ring-accent | удалено, общая обводка |
| components/settings/SettingsPresets.tsx:84 | ring-accent | сохранено: признак состояния, ошибка замера |
| components/settings/TranscriptionSettingsCard.tsx:99 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:366 | focus-visible:ring-fg-faint | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:397 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:414 | ring-danger-muted | сохранено: признак состояния, ошибка замера |
| components/sprint/AddEntryForm.tsx:431 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:447 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:489 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:579 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:603 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/AddEntryForm.tsx:647 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/EntryCard.tsx:129 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/ManagerSection.tsx:124 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/ManagerSection.tsx:136 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/ManagerSection.tsx:143 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/ReviewerForm.tsx:177 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/ReviewerForm.tsx:235 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/ReviewerForm.tsx:293 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/ReviewerForm.tsx:325 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/SelfReviewForm.tsx:204 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/SelfReviewForm.tsx:224 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/SelfReviewForm.tsx:244 | focus:ring-accent-ring | удалено, общая обводка |
| components/sprint/SprintHeader.tsx:37 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/SprintHeader.tsx:58 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/sprint/SprintHeader.tsx:90 | focus-visible:ring-accent-ring | удалено, общая обводка |
| components/ui/InfoHint.tsx:18 | focus-visible:ring-accent | удалено, общая обводка |
| components/ui/input.tsx:12 | focus:ring-accent-subtle-alt | удалено, общая обводка |
| components/ui/input.tsx:31 | focus:ring-danger-subtle | удалено, общая обводка |
| components/ui/input.tsx:55 | focus:ring-danger-subtle | удалено, общая обводка |
| components/ui/input.tsx:88 | focus:ring-danger-subtle | удалено, общая обводка |
| pages/AttestationTakePage.tsx:109 | focus:ring-accent-ring | удалено, общая обводка |
| pages/LoginPage.tsx:186 | focus:ring-accent | удалено, общая обводка |
| pages/SettingsPage.tsx:101 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:772 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:779 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:817 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:818 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:1353 | ring-accent-ring | сохранено: признак состояния, ошибка замера |
| pages/SettingsPage.tsx:1402 | ring-accent-ring | сохранено: признак состояния, ошибка замера |
| pages/SettingsPage.tsx:1626 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:1633 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:1688 | focus:ring-accent-ring | удалено, общая обводка |
| pages/SettingsPage.tsx:1694 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:142 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:153 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:366 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:447 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:453 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:459 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:1377 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:1491 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:2060 | focus:ring-danger | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:2104 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:2151 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:2160 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:2171 | focus:ring-accent-ring | удалено, общая обводка |
| pages/admin/CompanyDetailPage.tsx:2181 | focus:ring-accent-ring | удалено, общая обводка |

За пределами снимка удалён ещё 21 остаточный класс focus:outline-none / focus:ring-0 в 6 файлах: ChangePasswordCard, CrmIntegrationSettings, TranscriptionStatusBadge, InvitePage, OfferPage, RopBonusOfferPage. Они были частями прежнего механизма локального фокуса; теперь весь фокус задаёт общее правило.

## Цветовые литералы

Снимок: 9 → 0. Восемь hex в PRESET_COLORS (TagManager.tsx:14–15) — пользовательские данные, а не роли интерфейса. Это уже принятое решение владельца от 09.09.2026, зафиксированное также в no-accent-drift.mjs:29–31. Девятый литерал (EMPTY_FORM.color) дублировал первый элемент палитры: теперь берётся PRESET_COLORS[0], цвет нового тега не изменился.

Восемь значений сохранены: #EF4444, #F59E0B, #F97316, #8B5CF6, #EC4899, #06B6D4, #10B981, #6366F1. Дефолт был и остался #EF4444. Все девять снятых находок относятся к данным; новый допуск на оформление не введён.

Замок разрешает только корневое const-объявление массива hex PRESET_COLORS в components/analytics/TagManager.tsx. Вне его инициализатора файл проверяется полностью: добавленный рядом style с литералом обязан падать. Такой же массив с таким именем в другом файле тоже падает.

Почему нельзя заменить данные на var(): error_tags.color хранится как varchar, DTO проверяет строку, потребители получают её как есть. Badge tone/readableOn вычисляет контраст только для hex; var() дал бы белый текст без вычисления. Это причина сохранить данные, а не отложенный переезд. Источники: backend/src/error-tags/dto/create-error-tag.dto.ts, backend/src/error-tags/entities/error-tag.entity.ts, frontend/src/components/ui/badge.tsx, TagManager, ErrorTagPill, EntryCard, ReviewerForm.

## Шкала

no-offscale: снимка уже не было на исходном e1aed2e; удалять повторно нечего. Находок 0. Убрано и само чтение baseline из замка: даже повторно положенный JSON больше не сможет разрешить нарушение. Замок работает обычным запретом.

## Проверки

- Chromium: 343/343, файл debt-browser-results.json; воспроизводимый скрипт debt-browser-check.mjs. Источник before — e1aed2e, after — фактически прочитанный текущий src; SHA-256 всех затронутых исходников сохранены в результате и перепроверены основным тредом.
- Реальный JSX кнопки SelfReviewForm с настоящими Button/cn: #22C55E → #15803D, белый #FFFFFF, 2,2786093403 → 5,0155974781. Размер 133,125 × 38,84375 px, отступы, шрифт и скругление одинаковы.
- Настоящие Input/Textarea/Select: 6 состояний normal/error, геометрия сохранена; клавиатурная модальность задана Tab через CDP и подтверждена matches(':focus-visible'); обводка #773706, 2px, отступ 2px.
- Полный реестр 84 удалений сопоставлен с текущим AST по строке и порядку литерала; 48 уникальных пар отрисованы изолированными фрагментами. Для трёх цветовых веток без собственной ширины измерен --tw-ring-color: самостоятельного видимого кольца такая ветка не рисует. Для остальных — boxShadow. У всех новых фрагментов фокус не меняет локальную тень, общая обводка видна.
- Все 8 постоянных колец проверены отдельно (две одинаковые строки RopBonusSettings не схлопнуты): тень вне фокуса и геометрия сохранены.
- Граница браузерного прогона: реальные общие компоненты и реальные JSX/классовые фрагменты; это не обход всех страниц с живыми клиентскими данными. Измеряется установившееся состояние, CSS transitions в проверочной странице отключены.
- Слом через публичный CLI no-white-on-fill: неизменный bg-accent text-on-dark; значение роли #B45309 → #D16310 → #B45309 даёт exit 0 → 1 → 0. Самопроверки встроены в замок и выполняются при каждом запуске: 28 случаев.
- no-raw-color: 13 самопроверок; one-focus-ring: 20; no-offscale: грязный/чистый образцы. Новый код не читает ни один из четырёх снимков долга.
- TypeScript: tsc -b прошёл. Сервер: 26 наборов, 332 теста — все прошли. Штатный ui-native-check.mjs — 0 находок.

Незакрытых допусков в четырёх снимках не осталось. Пользовательские цвета сохранены как данные по уже принятому решению, без ожидания нового выбора владельца.

Полная итоговая проверка: `npm run build` во frontend завершилась с кодом 0. Все 18 замков зелёные, TypeScript и Vite прошли, OG-маршрут собран. Полный stdout/stderr сохранён в debt-build-output.txt. След акцента обновлён после браузерного доказательства: 77 удалённых обращений относятся только к локальным focus:ring; значения ролей и остальные назначения src сохранены. Все четыре JSON снимка долга отсутствуют.
