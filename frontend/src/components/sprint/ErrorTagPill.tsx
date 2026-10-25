import type { ErrorTag } from '@/types';
import { formatTagName } from '@/lib/utils';
import { Button } from '@chirkov/shell';
import { ColorTagBadge } from '@/components/ui/badge';

interface ErrorTagPillProps {
  tag: ErrorTag;
  onRemove?: () => void;
}

export function ErrorTagPill({ tag, onRemove }: ErrorTagPillProps) {
  return (
    <ColorTagBadge color={tag.color}>
      {formatTagName(tag.name)}
      {onRemove && (
        <Button
          onClick={onRemove}
          variant="link"
          size="sm"
          type="button"
          aria-label={`Удалить тег ${formatTagName(tag.name)}`}
        >
          ×
        </Button>
      )}
    </ColorTagBadge>
  );
}
