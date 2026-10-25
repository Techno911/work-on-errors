import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, RefreshCw } from 'lucide-react';
import { telegramLinkApi, type TelegramLinkInfo } from '@/api/telegram-link';
import { cn } from '@/lib/utils';
import { Button, ButtonLink } from '@chirkov/shell';

/**
 * Самопривязка Telegram в два клика: «Подключить» открывает бота с deep-link,
 * «Проверить» связывает chat_id с аккаунтом (владельцу чат сразу дописывается
 * в каналы еженедельного отчёта). Заменяет ручное «напишите боту /start и
 * передайте @username админу».
 */
export function TelegramLinkButton({ onLinked }: { onLinked?: (chatId: string | null) => void }) {
  const [info, setInfo] = useState<TelegramLinkInfo | null>(null);
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    telegramLinkApi.getMy().then(({ data }) => setInfo(data)).catch(() => setInfo(null));
  }, []);

  if (!info || !info.enabled || !info.deepLink) return null;

  if (info.linked) {
    return (
      <span className="inline-flex items-center gap-1.5 text-body text-success-fg">
        <Check className="w-4 h-4" /> Telegram подключён
      </span>
    );
  }

  const handleCheck = async () => {
    setChecking(true);
    try {
      const { data } = await telegramLinkApi.check();
      if (data.linked) {
        setInfo(prev => (prev ? { ...prev, linked: true } : prev));
        toast.success(data.autoWired ? 'Telegram подключён, отчёты будут приходить сюда' : 'Telegram подключён');
        onLinked?.(data.chatId);
      } else {
        toast.error('Пока не видим вас у бота. Нажмите Start в Telegram и проверьте ещё раз.', { duration: 8000 });
      }
    } catch {
      toast.error('Не удалось проверить подключение', { duration: Infinity });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="inline-flex max-w-full items-center gap-2 flex-wrap">
      <ButtonLink
        href={info.deepLink}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpened(true)}
        variant="primary"
      >
        Подключить Telegram
      </ButtonLink>
      {opened && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleCheck}
          disabled={checking}
          icon={<RefreshCw className={cn(checking && 'animate-spin')} />}
        >
          {checking ? 'Проверяем…' : 'Я нажал Start, проверить'}
        </Button>
      )}
    </div>
  );
}
