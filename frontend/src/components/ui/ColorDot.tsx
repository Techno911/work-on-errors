import { categoryColor } from '@chirkov/shell';

/**
 * Точка цвета из данных (тег ошибки, участник команды). Цвет проходит через
 * categoryColor пакета: системная категория берётся из токенов, незнакомый
 * цвет пакет сам помечает как данные.
 */
export function ColorDot({ color, className }: { color?: string | null; className: string }) {
  const resolved = color
    ? categoryColor(color)
    : { backgroundColor: 'var(--color-fg-disabled)', dataDsException: undefined };
  return (
    <span
      data-ds-exception={resolved.dataDsException}
      className={`rounded-full flex-shrink-0 ${className}`}
      style={{ backgroundColor: resolved.backgroundColor }} // ds-исключение: значение даёт categoryColor пакета (токен категории либо цвет из данных)
    />
  );
}
