import { useEffect, useId, useMemo, useState } from 'react';
import { Select } from './Select';

const months = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

interface DateParts {
  year: string;
  month: string;
  day: string;
}

export interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  hint?: string;
  error?: string;
  minYear: number;
  maxYear: number;
  required?: boolean;
  disabled?: boolean;
}

const emptyParts = (): DateParts => ({ year: '', month: '', day: '' });
const pad = (value: number) => String(value).padStart(2, '0');

function daysInMonth(year: string, month: string) {
  if (!month) return 31;
  const safeYear = year ? Number(year) : 2000;
  return new Date(safeYear, Number(month), 0).getDate();
}

function isoFromParts(parts: DateParts) {
  if (!parts.year || !parts.month || !parts.day) return '';
  if (Number(parts.day) > daysInMonth(parts.year, parts.month)) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function partsFromIso(value: string): DateParts {
  if (!value) return emptyParts();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return emptyParts();
  const [, year, month, day] = match;
  const parts = { year, month, day };
  return isoFromParts(parts) === value ? parts : emptyParts();
}

export function DateField({
  value,
  onChange,
  label,
  hint,
  error,
  minYear,
  maxYear,
  required = false,
  disabled = false,
}: DateFieldProps) {
  const firstYear = Math.min(minYear, maxYear);
  const lastYear = Math.max(minYear, maxYear);
  const [parts, setParts] = useState(() => partsFromIso(value));
  const generatedId = useId();
  const hintId = hint ? `chip-date-${generatedId}-hint` : undefined;
  const errorId = error ? `chip-date-${generatedId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const dayCount = daysInMonth(parts.year, parts.month);
  const years = useMemo(() => {
    const range = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => lastYear - index);
    const savedYear = Number(parts.year);
    if (parts.year && !range.includes(savedYear)) range.push(savedYear);
    return range.sort((left, right) => right - left);
  }, [firstYear, lastYear, parts.year]);

  useEffect(() => {
    const currentIso = isoFromParts(parts);
    if (value && value !== currentIso) setParts(partsFromIso(value));
    if (!value && currentIso) setParts(emptyParts());
  }, [value]);

  const change = (part: keyof DateParts, nextValue: string) => {
    const next = { ...parts, [part]: nextValue };
    if (next.day && Number(next.day) > daysInMonth(next.year, next.month)) next.day = '';
    setParts(next);
    onChange(isoFromParts(next));
  };

  return (
    <fieldset className="chip-field chip-date-field" disabled={disabled} data-invalid={Boolean(error) || undefined}>
      <legend className="chip-field__label">
        {label}
        {required ? <span className="chip-field__required" aria-hidden="true">*</span> : null}
      </legend>
      <div className="chip-date-field__controls">
        <span className="chip-date-field__part chip-date-field__part--day">
          <Select
            aria-label={`${label}: день`}
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            required={required}
            disabled={disabled}
            value={parts.day}
            onChange={(event) => change('day', event.currentTarget.value)}
          >
            <option value="">День</option>
            {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => (
              <option key={day} value={pad(day)}>{day}</option>
            ))}
          </Select>
        </span>
        <span className="chip-date-field__part chip-date-field__part--month">
          <Select
            aria-label={`${label}: месяц`}
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            required={required}
            disabled={disabled}
            value={parts.month}
            onChange={(event) => change('month', event.currentTarget.value)}
          >
            <option value="">Месяц</option>
            {months.map((month, index) => (
              <option key={month} value={pad(index + 1)}>{month}</option>
            ))}
          </Select>
        </span>
        <span className="chip-date-field__part chip-date-field__part--year">
          <Select
            aria-label={`${label}: год`}
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            required={required}
            disabled={disabled}
            value={parts.year}
            onChange={(event) => change('year', event.currentTarget.value)}
          >
            <option value="">Год</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </Select>
        </span>
      </div>
      {hint ? <p id={hintId} className="chip-field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="chip-field__error" role="alert">{error}</p> : null}
    </fieldset>
  );
}
