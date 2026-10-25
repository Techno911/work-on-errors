import { useState } from 'react';
import { toast } from 'sonner';
import { FileDown } from 'lucide-react';
import { playbookApi } from '@/api/playbook';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@chirkov/shell';

interface PlaybookExportButtonProps {
  companyId: string;
  disabled?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function PlaybookExportButton({ companyId, disabled }: PlaybookExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const companyName = useAuthStore((s) => s.user?.company?.name) ?? '';

  const handleExport = async () => {
    setLoading(true);
    try {
      const { data } = await playbookApi.getExportData(companyId);
      if (data.length === 0) {
        toast.error('В методичке пока нет ни одной карточки');
        return;
      }
      const stamp = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      // Новая вкладка не наследует CSS приложения: переносим вычисленные роли в её :root.
      const tokenNames = [
        '--color-fg',
        '--color-fg-subtle',
        '--color-border',
        '--color-danger-subtle',
        '--color-danger-fg',
        '--color-success-subtle',
        '--color-success-fg',
      ] as const;
      const appStyles = window.getComputedStyle(document.documentElement);
      const tokenDeclarations = tokenNames
        .map((name) => `${name}: ${appStyles.getPropertyValue(name).trim()};`)
        .join('');
      const sections = data.map((card, i) => `
        <section class="card">
          <h2>${i + 1}. ${escapeHtml(card.title)}</h2>
          <p class="rule">${escapeHtml(card.ruleText ?? '')}</p>
          ${card.examples.length > 0 ? `
            <ul class="examples">
              ${card.examples.map((ex) => `<li class="${ex.kind}">${ex.kind === 'bad' ? '✗' : '✓'} «${escapeHtml(ex.quote)}»</li>`).join('')}
            </ul>
          ` : ''}
        </section>
      `).join('');

      const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Методичка по продажам${companyName ? ` · ${escapeHtml(companyName)}` : ''}</title>
<style>
  :root { ${tokenDeclarations} }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 24px; color: var(--color-fg); line-height: 1.6; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .subtitle { color: var(--color-fg-subtle); font-size: 13px; margin-bottom: 32px; }
  .card { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border); }
  .card:last-child { border-bottom: none; }
  h2 { font-size: 16px; margin-bottom: 8px; }
  .rule { font-size: 14px; margin-bottom: 10px; }
  .examples { list-style: none; padding: 0; margin: 0; font-size: 13px; }
  .examples li { padding: 6px 10px; border-radius: 8px; margin-bottom: 6px; }
  .examples li.bad { background: var(--color-danger-subtle); color: var(--color-danger-fg); }
  .examples li.good { background: var(--color-success-subtle); color: var(--color-success-fg); }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>Методичка по продажам${companyName ? ` · ${escapeHtml(companyName)}` : ''}</h1>
  <p class="subtitle">Собрано из разборов звонков и переписок · по состоянию на ${stamp} · ${data.length} правил</p>
  ${sections}
</body>
</html>`;

      const win = window.open('', '_blank');
      if (!win) {
        toast.error('Браузер заблокировал открытие вкладки: разрешите всплывающие окна');
        return;
      }
      win.document.write(html);
      win.document.close();
    } catch {
      toast.error('Не удалось собрать документ', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="secondary" size="md"
      onClick={handleExport}
      disabled={disabled || loading}
      icon={<FileDown />}
    >
      {loading ? 'Собираем…' : 'Собрать документ'}
    </Button>
  );
}
