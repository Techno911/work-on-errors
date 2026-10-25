import { Tabs } from '@chirkov/shell';

type Period = 'all' | 'month' | 'quarter';

interface PeriodFilterProps {
  value: Period;
  onChange: (period: Period) => void;
}

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'all', label: 'Всё время' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
];

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as Period)}>
      <Tabs.List ariaLabel="Период">
        {OPTIONS.map(opt => (
          <Tabs.Tab key={opt.value} value={opt.value}>{opt.label}</Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
