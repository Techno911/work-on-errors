import { Link } from 'react-router-dom';
import { ButtonLink } from '@chirkov/shell';

const DAY_TO_INDEX: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
};
const DAY_LABEL: Record<string, string> = {
  monday: 'понедельника', tuesday: 'вторника', wednesday: 'среды',
  thursday: 'четверга', friday: 'пятницы', saturday: 'субботы', sunday: 'воскресенья',
};

interface Props {
  role: 'manager' | 'reviewer';
  deadlineDay: string;            // "wednesday" / "friday"
  pending: number;                // менеджер: сколько записей ещё нужно. РОП: pendingCount.
}

function hoursUntil(deadlineDayName: string): number {
  const target = DAY_TO_INDEX[deadlineDayName.toLowerCase()] ?? 5;
  const now = new Date();
  const day = now.getDay();
  const diff = (target - day + 7) % 7;
  // Срок в конце дня (23:59 дня сдачи)
  const deadline = new Date(now);
  deadline.setDate(now.getDate() + diff);
  deadline.setHours(23, 59, 0, 0);
  const ms = deadline.getTime() - now.getTime();
  return Math.round(ms / (1000 * 60 * 60));
}

export function DeadlineCountdownBanner({ role, deadlineDay, pending }: Props) {
  if (pending <= 0) return null;
  const hoursLeft = hoursUntil(deadlineDay);
  // Показываем только за 36 часов до срока (примерно вечер накануне и весь день сдачи)
  if (hoursLeft > 36) return null;

  const overdue = hoursLeft < 0;
  const dayName = DAY_LABEL[deadlineDay.toLowerCase()] ?? 'срока';

  const bg = overdue
    ? 'bg-danger-subtle border-danger-border'
    : hoursLeft <= 8
      ? 'bg-accent-subtle border-accent-border'
      : 'bg-warning-subtle border-warning-border';

  const accentForeground = overdue ? 'var(--color-danger)' : hoursLeft <= 8 ? 'var(--color-accent)' : 'var(--color-warning)';
  const buttonVariant = overdue ? 'danger' : hoursLeft <= 8 ? 'primary' : 'secondary';

  const noun = (n: number) => {
    if (role === 'manager') {
      return n === 1 ? 'запись' : n < 5 ? 'записи' : 'записей';
    }
    return 'ревью';
  };

  // Субъект и действие названы явно; вместо паники — посильный следующий шаг
  const action = role === 'manager' ? 'Загрузить записи' : 'Проверить записи';
  const headline = overdue
    ? `Срок сдачи (до ${dayName}, 23:59) прошёл. Осталось ${pending} ${noun(pending)}.`
    : hoursLeft <= 8
      ? `${action} сегодня до 23:59. Осталось ${pending} ${noun(pending)}.`
      : `${action} до ${dayName}, 23:59. Осталось ${pending} ${noun(pending)}.`;

  // Пятница у менеджера — крайний день, а не рабочий: норматив рассчитан на понедельник–четверг.
  const isDeadlineToday = hoursLeft >= 0 && hoursLeft <= 24;
  const subtext = role === 'manager'
    ? (overdue || (hoursLeft <= 1 && pending > 2)
        ? 'Загрузите самые важные, остальное обсудите с РОПом.'
        : isDeadlineToday
          ? 'Крайний день недели. В следующий раз распределите записи по дням: так разбор идёт быстрее и навык растёт.'
          : 'Начните с одной: разбор занимает около 15 минут.')
    : 'После срока задержки попадают в еженедельный отчёт собственнику.';

  return (
    <div className={`rounded-block border ${bg} px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3`}>
      <div className="flex-1 min-w-0">
        <div className="text-body font-semibold" style={{ color: accentForeground }}>{headline}</div>
        <div className="text-micro text-fg-muted mt-0.5">{subtext}</div>
      </div>
      <div className="flex-shrink-0 w-full sm:w-auto">
        <ButtonLink as={Link} to="/sprint" variant={buttonVariant} size="sm" fullWidth>
          К доске спринта →
        </ButtonLink>
      </div>
    </div>
  );
}
