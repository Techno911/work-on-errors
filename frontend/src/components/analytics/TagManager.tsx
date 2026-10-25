import { toast } from 'sonner';
import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { cn, formatTagName } from '@/lib/utils';
import { errorTagsApi } from '@/api/error-tags';
import type { ErrorTag } from '@/types';
import { Button, Input, Badge, Card, Modal, categoryColor } from '@chirkov/shell';
import { ColorDot } from '@/components/ui/ColorDot';

// Восемь категорий пакета; тег хранит имя токена, старые hex читает categoryColor.
const CATEGORY_TOKENS = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `--chip-color-category-${n}`);

interface TagFormData {
  name: string;
  description: string;
  color: string;
}

const EMPTY_FORM: TagFormData = { name: '', description: '', color: CATEGORY_TOKENS[0] };

interface TagManagerProps {
  companyId: string;
  tags: ErrorTag[];
  onTagsChange: (tags: ErrorTag[]) => void;
  tagCounts?: Map<string, number>; // частота использования: tagId → count
}

export function TagManager({ companyId, tags, onTagsChange, tagCounts }: TagManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TagFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ tag: ErrorTag; count: number } | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (tag: ErrorTag) => {
    setEditingId(tag.id);
    setFormData({ name: tag.name, description: tag.description ?? '', color: tag.color });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const { data } = await errorTagsApi.update(editingId, formData);
        onTagsChange(tags.map(t => t.id === editingId ? data : t));
      } else {
        const { data } = await errorTagsApi.create({ ...formData, companyId });
        onTagsChange([...tags, data]);
      }
      cancelForm();
    } catch {
      toast.error('Не удалось сохранить тег. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (tagId: string) => {
    try {
      await errorTagsApi.delete(tagId);
      onTagsChange(tags.filter(t => t.id !== tagId));
      setDeleteConfirm(null);
    } catch {
      toast.error('Не удалось удалить тег. Попробуйте ещё раз', { duration: Infinity });
    }
  };

  const handleDeleteClick = async (tag: ErrorTag) => {
    setDeletingId(tag.id);
    try {
      const { data } = await errorTagsApi.getUsage(tag.id);
      if (data.count > 0) {
        setDeleteConfirm({ tag, count: data.count });
      } else {
        await confirmDelete(tag.id);
      }
    } catch {
      toast.error('Не удалось удалить тег. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Tags list */}
      <div className="space-y-2">
        {tags.map(tag => (
          <div key={tag.id} className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-block hover:bg-canvas group">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
              <ColorDot color={tag.color} className="w-3 h-3" />
              <span className="text-body font-medium text-fg">{formatTagName(tag.name)}</span>
              {tagCounts && (tagCounts.get(tag.id) ?? 0) > 0 && (
                <Badge tone="neutral">{tagCounts.get(tag.id)}×</Badge>
              )}
              {tag.description && (
                <span className="text-micro text-fg-subtle hidden group-hover:block">{tag.description}</span>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => openEdit(tag)}
                aria-label={`Редактировать тег ${formatTagName(tag.name)}`}
                icon={<Pencil />}
              />
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => handleDeleteClick(tag)}
                disabled={deletingId === tag.id}
                aria-label={`Удалить тег ${formatTagName(tag.name)}`}
                icon={<Trash2 />}
              />
            </div>
          </div>
        ))}

        {tags.length === 0 && (
          <p className="text-body text-fg-subtle py-2 text-center">Нет тегов ошибок</p>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card padding="sm" surface="canvas" radius="block" className="space-y-3">
          <h4 className="text-body font-semibold text-fg-muted">
            {editingId ? 'Редактировать тег' : 'Новый тег'}
          </h4>

          <Input
            type="text"
            value={formData.name}
            onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
            placeholder="Название тега (без пробелов)"
          />

          <Input
            type="text"
            value={formData.description}
            onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
            placeholder="Описание (необязательно)"
          />

          <div>
            <p className="text-micro text-fg-subtle mb-2">Цвет:</p>
            <div className="flex gap-2">
              {CATEGORY_TOKENS.map((token, index) => {
                const selected = categoryColor(formData.color).category === index + 1;
                return (
                  <Button
                    key={token}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Цвет ${index + 1}`}
                    aria-pressed={selected}
                    onClick={() => setFormData(p => ({ ...p, color: token }))}
                    icon={
                      <ColorDot
                        color={token}
                        className={cn(
                          'w-5 h-5 border-2 transition-all',
                          selected ? 'border-fg scale-110' : 'border-transparent'
                        )}
                      />
                    }
                  />
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Button
                variant="primary"
                size="md"
                fullWidth
                type="button"
                onClick={handleSave}
                disabled={!formData.name.trim() || saving}
              >
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="md"
              type="button"
              onClick={cancelForm}
            >
              Отмена
            </Button>
          </div>
        </Card>
      )}

      {/* Add button */}
      {!showForm && (
        <Button
          variant="link"
          size="md"
          type="button"
          onClick={openCreate}
          icon={<Plus />}
        >
          Добавить тег
        </Button>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <Modal
          open
          onClose={() => setDeleteConfirm(null)}
          title="Удалить тег?"
          footer={(
            <>
              <Button variant="danger" size="md"
                type="button"
                onClick={() => confirmDelete(deleteConfirm.tag.id)}
              >
                Удалить
              </Button>
              <Button variant="ghost" size="md"
                type="button"
                onClick={() => setDeleteConfirm(null)}
              >
                Отмена
              </Button>
            </>
          )}
        >
          <p className="text-body text-fg-muted">
            Тег <strong>#{deleteConfirm.tag.name}</strong> используется в{' '}
            <strong>{deleteConfirm.count} записях</strong>. Удаление уберёт тег из всех записей.
          </p>
        </Modal>
      )}
    </div>
  );
}
