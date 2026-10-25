export type CategoryColorIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type CategoryColorInput = CategoryColorIndex | string;

export interface CategoryColorResult {
  backgroundColor: string;
  textColor: 'var(--chip-color-on-category)';
  category?: CategoryColorIndex;
  source: 'system' | 'data';
  dataDsException?: 'цвет из данных';
}

// Соответствие выбрано по минимальной круговой дистанции оттенка HSV.
export const legacyCategoryColors: Readonly<Record<string, CategoryColorIndex>> = {
  '#EF4444': 2,
  '#F59E0B': 3,
  '#F97316': 2,
  '#8B5CF6': 8,
  '#EC4899': 1,
  '#06B6D4': 6,
  '#10B981': 5,
  '#6366F1': 8,
};

function systemColor(category: CategoryColorIndex): CategoryColorResult {
  return {
    backgroundColor: `var(--chip-color-category-${category})`,
    textColor: 'var(--chip-color-on-category)',
    category,
    source: 'system',
  };
}

/** Возвращает системную категорию или помечает цвет, пришедший из данных. */
export function categoryColor(value: CategoryColorInput): CategoryColorResult {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8) {
    return systemColor(value as CategoryColorIndex);
  }

  const normalized = String(value).trim();
  const legacy = legacyCategoryColors[normalized.toUpperCase()];
  if (legacy) return systemColor(legacy);

  const token = normalized.match(/^--chip-color-category-([1-8])$/);
  if (token) return systemColor(Number(token[1]) as CategoryColorIndex);

  const variable = normalized.match(/^var\(--chip-color-category-([1-8])\)$/);
  if (variable) return systemColor(Number(variable[1]) as CategoryColorIndex);

  return {
    backgroundColor: normalized,
    textColor: 'var(--chip-color-on-category)',
    source: 'data',
    dataDsException: 'цвет из данных',
  };
}
