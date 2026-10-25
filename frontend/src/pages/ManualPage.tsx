import { useState, useEffect, type ReactNode, type ReactElement } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { MANUAL_MANAGER } from '@/content/manual-manager';
import { MANUAL_REVIEWER } from '@/content/manual-reviewer';
import { MANUAL_OWNER } from '@/content/manual-owner';
import { MANUAL_TRACKER } from '@/content/manual-tracker';
import { UserTour } from '@/components/onboarding/UserTour';
import { ExampleReviewModal } from '@/components/onboarding/ExampleReviewModal';
import { useFirstStepsHidden } from '@/hooks/useFirstStepsHidden';
import { dashboardApi } from '@/api/dashboard';
import type { FirstStep } from '@/components/onboarding/FirstStepsCard';
import { Button, Card, ListRow, Table, Tabs } from '@chirkov/shell';

type Tab = 'tracker' | 'manager' | 'reviewer' | 'owner';
// У трекера нет продуктового тура (тур водит по экранам роли клиента).
type TourTab = 'manager' | 'reviewer' | 'owner';

const TAB_LABELS: Record<Tab, string> = {
  tracker: 'Для трекера',
  manager: 'Для менеджера',
  reviewer: 'Для РОПа',
  owner: 'Для владельца',
};
// Подпись кнопки тура: «для РОПа» с сохранением регистра аббревиатуры.
const TOUR_ROLE_LABEL: Record<TourTab, string> = {
  manager: 'для менеджера',
  reviewer: 'для РОПа',
  owner: 'для владельца',
};
const TAB_CONTENT: Record<Tab, string> = {
  tracker: MANUAL_TRACKER,
  manager: MANUAL_MANAGER,
  reviewer: MANUAL_REVIEWER,
  owner: MANUAL_OWNER,
};

// Очень простой markdown-рендер: только то, что мы реально используем (h1/h2/h3, списки,
// жирный, кавычки, inline code, table одной шириной). Без зависимостей — экономим вес.
function renderMd(md: string, anchorId?: (h: string) => string): ReactElement[] {
  const out: ReactElement[] = [];
  const lines = md.split('\n');
  let i = 0;
  let key = 0;
  const k = () => `n${key++}`;

  const inline = (s: string): ReactNode[] => {
    // **bold** + `code`
    const parts: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) {
        parts.push(<strong key={k()}>{tok.slice(2, -2)}</strong>);
      } else {
        parts.push(<code key={k()} className="px-1 py-0.5 rounded-chip bg-surface-sunken text-accent-hover text-body font-mono">{tok.slice(1, -1)}</code>);
      }
      last = m.index + tok.length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Headers
    if (line.startsWith('# ')) { out.push(<h2 key={k()} className="text-section font-bold text-fg mt-2 mb-4">{line.slice(2)}</h2>); i++; continue; }
    if (line.startsWith('## ')) { const h = line.slice(3); out.push(<h2 key={k()} id={anchorId ? anchorId(h.trim()) : undefined} className="text-title font-semibold text-fg mt-8 mb-3 scroll-mt-20">{h}</h2>); i++; continue; }
    if (line.startsWith('### ')) { out.push(<h3 key={k()} className="text-body-lg font-semibold text-fg mt-5 mb-2">{line.slice(4)}</h3>); i++; continue; }

    // Blockquote (multi-line)
    if (line.startsWith('> ')) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i].trim() === '>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(
        <blockquote key={k()} className="border-l-4 border-accent-focus pl-4 py-2 my-3 bg-accent-subtle rounded-r-chip text-fg-muted">
          {buf.map((l, idx) => <p key={idx} className="my-1 text-body">{inline(l)}</p>)}
        </blockquote>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      out.push(
        <ol key={k()} className="list-decimal pl-6 my-3 space-y-1 text-fg-muted">
          {items.map((it, idx) => <li key={idx} className="text-body">{inline(it)}</li>)}
        </ol>
      );
      continue;
    }

    // Bulleted list
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(
        <ul key={k()} className="list-disc pl-6 my-3 space-y-1 text-fg-muted">
          {items.map((it, idx) => <li key={idx} className="text-body">{inline(it)}</li>)}
        </ul>
      );
      continue;
    }

    // Table
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s|:-]+\|/.test(lines[i+1])) {
      const headers = line.split('|').slice(1, -1).map(s => s.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i].split('|').slice(1, -1).map(s => s.trim()));
        i++;
      }
      const plain = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
      const tableRows = rows.map((cells, id) => ({ id, cells }));
      out.push(
        <div key={k()} className="my-3">
          <Table
            caption={`Таблица: ${headers.map(plain).join(', ')}`}
            rows={tableRows}
            rowKey={(row) => row.id}
            mobile="scroll"
            empty="В таблице нет строк"
            columns={headers.map((h, ci) => ({
              key: `c${ci}`,
              header: plain(h),
              render: (row: { cells: string[] }) => inline(row.cells[ci] ?? ''),
            }))}
          />
        </div>
      );
      continue;
    }

    // Paragraph (collect until blank line)
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('- ') && !lines[i].startsWith('> ') && !/^\d+\.\s/.test(lines[i]) && !lines[i].startsWith('|')) {
      buf.push(lines[i]);
      i++;
    }
    out.push(<p key={k()} className="text-body text-fg-muted my-2">{inline(buf.join(' '))}</p>);
  }

  return out;
}

// Те же шаги, что на главной: единый состав по роли (менеджер — два собственных
// действия, РОП — одно ревью плюс навигационная подсказка).
const MANAGER_STEPS = (firstSteps?: { hasEntries: boolean; hasSelfReview: boolean }, fallbackEntries = 0, fallbackSelfReview = 0): FirstStep[] => [
  { label: 'Загрузить первую запись (звонок или переписку)', done: firstSteps?.hasEntries ?? fallbackEntries > 0 },
  { label: 'Заполнить самоанализ: что хорошо, что улучшить, выводы', done: firstSteps?.hasSelfReview ?? fallbackSelfReview > 0 },
];

/**
 * Раздел «Первые шаги» в Инструкции: помощь и пример разбора доступны и после
 * скрытия карточки, и после завершения шагов. Открытие раздела ничего не пишет
 * в профиль; действия скрытия/возврата нет в режиме «Глазами» (canToggle=false)
 * и у завершившего обучение (бесполезный переключатель не рисуем).
 */
function FirstStepsSection() {
  const user = useAuthStore(s => s.user);
  const { hidden, canToggle, busy, error, setHidden } = useFirstStepsHidden();
  const [steps, setSteps] = useState<FirstStep[] | null>(null);
  const [stepsError, setStepsError] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);

  useEffect(() => {
    if (!user?.companyId || (user.role !== 'manager' && user.role !== 'reviewer')) return;
    setStepsError(false);
    const load = user.role === 'manager'
      ? dashboardApi.getManagerData(user.companyId, user.id)
          .then(({ data }) => setSteps(MANAGER_STEPS(data.firstSteps, data.totalEntriesAllTime ?? 0, data.progress?.selfReviewCompleted ?? 0)))
      : dashboardApi.getReviewerData(user.companyId)
          .then(({ data }) => setSteps([
            { label: 'Написать первое ревью: что хорошо, главная ошибка, рекомендация, а также выбрать теги', done: data.firstSteps?.hasReviews ?? false },
          ]));
    load.catch(() => setStepsError(true));
  }, [user]);

  if (!user || (user.role !== 'manager' && user.role !== 'reviewer')) return null;

  const allDone = !!steps && steps.every(s => s.done);

  return (
    <Card padding="md" className="mb-6">
      <h2 className="text-body-lg font-semibold text-fg mb-1">Первые шаги</h2>
      {allDone && (
        <p className="text-body text-success-fg mb-2">Первые шаги выполнены</p>
      )}
      {steps === null && !stepsError && <p className="text-micro text-fg-subtle">Загружаем статус шагов…</p>}
      {stepsError && <p className="text-micro text-fg-subtle">Не удалось загрузить статус шагов. Он показан на главной, когда карточка видна.</p>}
      {steps && (
        <ul className="space-y-2 my-3">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2 text-body">
              {s.done
                ? <CheckCircle2 className="w-4 h-4 text-success-fg flex-shrink-0" />
                : <Circle className="w-4 h-4 text-border flex-shrink-0" />}
              <span className={s.done ? 'text-fg-subtle line-through' : 'text-fg-muted'}>{s.label}</span>
            </li>
          ))}
          {user.role === 'reviewer' && (
            <li className="flex items-center gap-2 text-body text-fg-subtle">Открыть запись со статусом «Ждёт ревью» на доске спринта</li>
          )}
        </ul>
      )}
      {error && <p className="text-micro text-danger mb-2">Не удалось сохранить. Проверьте связь и попробуйте ещё раз.</p>}
      <div className="first-steps-actions flex items-center gap-4 flex-wrap">
        {user.role === 'manager' && (
          <Button type="button" variant="link" size="sm" onClick={() => setExampleOpen(true)}>
            Посмотреть пример разбора →
          </Button>
        )}
        {canToggle && !allDone && !hidden && (
          <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => setHidden(true)}>
            {busy ? 'Сохраняем…' : 'Скрыть с главной'}
          </Button>
        )}
        {canToggle && !allDone && hidden && (
          <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => setHidden(false)}>
            {busy ? 'Сохраняем…' : 'Показать на главной'}
          </Button>
        )}
      </div>
      {exampleOpen && <ExampleReviewModal open onClose={() => setExampleOpen(false)} />}
    </Card>
  );
}

export function ManualPage() {
  const user = useAuthStore(s => s.user);

  // Вкладки по роли: менеджер видит свою; РОП — свою и менеджерскую; владелец — все клиентские;
  // трекер (суперадмин) — свою вкладку первой плюс все клиентские, чтобы понимать, что видит клиент.
  // Кадровые советы владельцу не должны читаться их объектом, поэтому РОП не видит вкладку владельца.
  const visibleTabs: Tab[] =
    user?.role === 'manager' ? ['manager'] :
    user?.role === 'reviewer' ? ['reviewer', 'manager'] :
    user?.role === 'tracker' ? ['tracker'] :
    user?.role === 'superadmin' ? ['tracker', 'owner', 'reviewer', 'manager'] :
    ['owner', 'reviewer', 'manager'];

  const [tab, setTab] = useState<Tab>(visibleTabs[0]);
  // Предпросмотр вводного тура выбранной роли — модалкой прямо здесь (работает и у суперадмина).
  const [showTour, setShowTour] = useState(false);

  // Оглавление: заголовки ## текущей вкладки
  const toc = TAB_CONTENT[tab]
    .split('\n')
    .filter(l => l.startsWith('## '))
    .map(l => l.slice(3).trim());
  const anchorId = (h: string) => 'sec-' + h.toLowerCase().replace(/[^а-яёa-z0-9]+/gi, '-');

  const scrollTo = (h: string) => {
    document.getElementById(anchorId(h))?.scrollIntoView({ behavior: 'auto' });
  };

  return (
    <div className="max-w-read mx-auto py-6">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-body text-fg-subtle mt-1">Как пользоваться платформой «Работа над ошибками»</p>
        </div>
        {tab !== 'tracker' && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowTour(true)}
          >
            Показать вводный тур{visibleTabs.length > 1 ? ` ${TOUR_ROLE_LABEL[tab]}` : ''}
          </Button>
        )}
      </div>

      <FirstStepsSection />

      {/* Tabs */}
      {visibleTabs.length > 1 && (
        <div className="mb-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <Tabs.List ariaLabel="Для кого руководство">
              {visibleTabs.map((t) => (
                <Tabs.Tab key={t} value={t}>{TAB_LABELS[t]}</Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </div>
      )}

      {/* Оглавление — нумерованный список в две колонки */}
      {toc.length > 2 && (
        <Card padding="md" className="mb-4">
          <p className="text-micro font-semibold uppercase tracking-overline text-fg-subtle mb-3">Содержание</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {toc.map((h, idx) => (
              <ListRow key={h} onClick={() => scrollTo(h)}>
                <span className="flex justify-start items-baseline gap-3 w-full text-left">
                  <span className="w-5 flex-shrink-0 text-micro font-mono tabular-nums text-fg-subtle">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="text-body text-fg-muted">{h}</span>
                </span>
              </ListRow>
            ))}
          </div>
        </Card>
      )}

      {/* Content */}
      <Card padding="md">
        {renderMd(TAB_CONTENT[tab], anchorId)}
      </Card>

      {/* Предпросмотр вводного тура выбранной роли (у трекера тура нет) */}
      {showTour && tab !== 'tracker' && (
        <UserTour role={tab} preview onClose={() => setShowTour(false)} />
      )}
    </div>
  );
}
