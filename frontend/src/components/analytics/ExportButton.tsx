import { toast } from 'sonner';
import { useState } from 'react';
import { analyticsApi } from '@/api/analytics';
import { Button, Select } from '@chirkov/shell';

interface ExportButtonProps {
  companyId: string;
}

type Period = 'all' | '4w' | '6w';
type Format = 'csv' | 'json';

interface ExportEntry {
  entryDate: string;
  sprintLabel: string;
  managerName: string;
  type: string;
  entryNumber: number;
  errorTags: string[];
  selfReview: { correct: string | null; improve: string | null; suggestions: string | null };
  reviewText: string | null;
}

// CSV для русского Excel: BOM + «;» как разделитель, кавычки удваиваются.
// Значение, начинающееся с =/+/-/@/таб/CR — потенциальная формула Excel/Sheets (CSV formula
// injection): текст ревью/самоанализа пишет менеджер или РОП, и строка вида «=HYPERLINK(...)»
// выполнилась бы при открытии файла тем, кто выгружает методичку. Ведущий апостроф гасит её.
function toCsv(entries: ExportEntry[]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ['Дата', 'Спринт', 'Менеджер', 'Тип', '№', 'Теги ошибок', 'Что правильно', 'Что улучшить', 'Предложение', 'Ревью РОПа'];
  const rows = entries.map(e => [
    esc(e.entryDate), esc(e.sprintLabel), esc(e.managerName),
    esc(e.type === 'call' ? 'Звонок' : 'Переписка'), esc(e.entryNumber),
    esc((e.errorTags ?? []).join(', ')),
    esc(e.selfReview?.correct), esc(e.selfReview?.improve), esc(e.selfReview?.suggestions),
    esc(e.reviewText),
  ].join(';'));
  return '﻿' + [header.map(esc).join(';'), ...rows].join('\r\n');
}

export function ExportButton({ companyId }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>('all');
  const [format, setFormat] = useState<Format>('csv');

  const handleExport = async () => {
    setLoading(true);
    try {
      let from: string | undefined;
      if (period !== 'all') {
        const weeks = period === '4w' ? 4 : 6;
        const d = new Date();
        d.setDate(d.getDate() - weeks * 7);
        from = d.toISOString();
      }
      const { data } = await analyticsApi.export(companyId, from);
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = format === 'csv'
        ? new Blob([toCsv((data as { entries: ExportEntry[] }).entries ?? [])], { type: 'text/csv;charset=utf-8' })
        : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `разборы-для-методички-${stamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Не удалось выгрузить данные. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-48">
        <Select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          aria-label="Период выгрузки для методички"
        >
          <option value="all">Весь период</option>
          <option value="4w">Последние 4 недели</option>
          <option value="6w">Последние 6 недель</option>
        </Select>
      </div>
      <div className="w-40">
        <Select
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
          aria-label="Формат выгрузки"
        >
          <option value="csv">CSV (Excel)</option>
          <option value="json">JSON</option>
        </Select>
      </div>
      <Button variant="secondary" size="md"
        type="button"
        onClick={handleExport}
        disabled={loading}
      >
        {loading ? 'Экспорт...' : 'Экспорт для методички'}
      </Button>
      <p className="basis-full w-full text-micro text-fg-subtle">Выгружаются только проверенные записи (звонки и переписки со статусом «Проверено») за выбранный период</p>
    </div>
  );
}
