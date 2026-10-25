import { Button } from '@chirkov/shell';

// Дефолтные источники используются как fallback если настройки компании не загружены
export const DEFAULT_CALL_SOURCES = ['Fireflies.ai', 'OTR.AI', 'Вручную'];
export const DEFAULT_CHAT_SOURCES = ['Instagram', 'Telegram', 'WhatsApp', 'VK', 'Другое'];

interface SourceSelectorProps {
  type: 'call' | 'chat';
  value: string;
  onChange: (value: string) => void;
  /** Кастомные источники из настроек компании. Если не переданы — используются дефолтные. */
  sources?: string[];
}

export function SourceSelector({ type, value, onChange, sources }: SourceSelectorProps) {
  const defaultSources = type === 'call' ? DEFAULT_CALL_SOURCES : DEFAULT_CHAT_SOURCES;
  const raw = sources && sources.length > 0 ? sources : defaultSources;
  // «Вручную» всегда первым: менеджер не обязан знать сервисы расшифровки
  const options = raw.includes('Вручную') ? ['Вручную', ...raw.filter(o => o !== 'Вручную')] : raw;
  const hasTranscriptionServices = type === 'call' && options.some(o => o !== 'Вручную');

  return (
    <div>
      <div className="flex flex-wrap gap-x-2 gap-y-3">
        {options.map(option => (
          <Button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            variant={value === option ? 'primary' : 'secondary'}
            size="sm"
          >
            {option}
          </Button>
        ))}
      </div>
      {hasTranscriptionServices && (
        <p className="text-micro text-fg-subtle mt-1.5">
          Fireflies и OTR распознают звонки в текст. Если не пользуетесь ими, оставьте «Вручную».
        </p>
      )}
    </div>
  );
}
