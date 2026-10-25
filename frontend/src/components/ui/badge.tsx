import { categoryColor } from '@chirkov/shell';

/**
 * Плашка цвета, пришедшего ИЗ ДАННЫХ (тег ошибки, который владелец покрасил
 * сам), а не из палитры ролей. Пакетный Badge такой цвет не выражает по
 * природе (нет style/className) — это единственное место, где местная плашка
 * остаётся: 23.09.2026, разобрано у EntryCard.tsx и ErrorTagPill.tsx.
 * Цвет и цвет текста даёт categoryColor пакета: системная категория или,
 * для незнакомого цвета, значение из данных с пометкой исключения от пакета.
 */
export function ColorTagBadge({ color, children }: { color: string; children: React.ReactNode }) {
  const resolved = categoryColor(color);
  return (
    <span
      data-ds-exception={resolved.dataDsException}
      className="inline-flex items-center justify-center gap-1 px-1.5 leading-none text-micro font-medium rounded-full" // ds-исключение: плашка цвета из данных; пакетный Badge цвет из данных не принимает
      style={{ backgroundColor: resolved.backgroundColor, color: resolved.textColor }} // ds-исключение: значения даёт categoryColor пакета (токен категории либо цвет из данных)
    >
      {children}
    </span>
  );
}
