import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import {
  categoryColor,
  type CategoryColorIndex,
  type CategoryColorInput,
} from '../categoryColor';

type NativeAvatarProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children' | 'className' | 'color' | 'style'
>;

export interface AvatarProps extends NativeAvatarProps {
  name: string;
  src?: string;
  color?: CategoryColorInput;
  size?: 'sm' | 'md';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? '?'}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

function categoryFromName(name: string): CategoryColorIndex {
  let hash = 0;
  for (const character of name.trim().toLocaleLowerCase('ru-RU')) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return ((hash % 8) + 1) as CategoryColorIndex;
}

export function Avatar({
  name,
  src,
  color,
  size = 'md',
  role,
  'aria-label': ariaLabel,
  ...props
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [src]);
  const fallback = useMemo(() => initials(name), [name]);
  const resolved = categoryColor(color ?? categoryFromName(name));
  const fromData = resolved.source === 'data';
  const style = fromData ? {
    backgroundColor: resolved.backgroundColor,
    color: resolved.textColor,
  } as CSSProperties : undefined;

  return (
    <span
      {...props}
      className={`chip-avatar chip-avatar--${size}${resolved.category ? ` chip-avatar--category-${resolved.category}` : ''}`}
      data-ds-exception={resolved.dataDsException}
      data-size={size}
      role={role ?? (props['aria-hidden'] ? undefined : 'img')}
      aria-label={ariaLabel ?? (props['aria-hidden'] ? undefined : name)}
      style={style}
    >
      {src && !imageFailed ? (
        <img src={src} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span className="chip-avatar__initials" aria-hidden="true">{fallback}</span>
      )}
    </span>
  );
}
