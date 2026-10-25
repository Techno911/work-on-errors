import { useId, useRef, useState, type DragEvent } from 'react';
import { Download, FileText, Trash2, Upload, X } from 'lucide-react';
import { Button } from './Button';

export interface StoredFile {
  name: string;
  size?: string;
}

export interface AvatarFileResult {
  file: File;
  previewUrl: string;
}

export interface FileFieldProps {
  label: string;
  hint?: string;
  accept?: string;
  disabled?: boolean;
  error?: string;
  file?: File | null;
  onFileChange?: (file: File | null) => void;
  multiple?: boolean;
  files?: readonly File[];
  onFilesChange?: (files: File[]) => void;
  storedFile?: StoredFile;
  onDownload?: () => void;
  onDelete?: () => void;
  variant?: 'file' | 'avatar';
  avatarPreview?: string;
  avatarFallback?: string;
  onAvatarChange?: (result: AvatarFileResult) => void;
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/** Центральный квадрат кадрируется в браузере до отправки на сервер. */
export async function cropAvatarFile(file: File): Promise<AvatarFileResult> {
  const source = await readDataUrl(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    image.src = source;
  });

  const canvas = document.createElement('canvas');
  const cropSize = 120;
  canvas.width = cropSize;
  canvas.height = cropSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Кадрирование изображения недоступно');
  const sourceSize = Math.min(image.width, image.height);
  const sourceX = (image.width - sourceSize) / 2;
  const sourceY = (image.height - sourceSize) / 2;
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, cropSize, cropSize);
  const previewUrl = canvas.toDataURL('image/jpeg', 0.85);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Не удалось сохранить изображение')), 'image/jpeg', 0.85);
  });
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'avatar';
  return {
    file: new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified }),
    previewUrl,
  };
}

export function FileField({
  label,
  hint,
  accept,
  disabled = false,
  error,
  file = null,
  onFileChange,
  multiple = false,
  files = [],
  onFilesChange,
  storedFile,
  onDownload,
  onDelete,
  variant = 'file',
  avatarPreview,
  avatarFallback = '?',
  onAvatarChange,
}: FileFieldProps) {
  const inputId = useId();
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localAvatar, setLocalAvatar] = useState<string | undefined>();

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  const selectFiles = async (selected: File[]) => {
    if (!selected.length) return;
    if (variant === 'avatar') {
      const result = await cropAvatarFile(selected[0]);
      setLocalAvatar(result.previewUrl);
      onFileChange?.(result.file);
      onAvatarChange?.(result);
    } else if (multiple) {
      onFilesChange?.([...files, ...selected]);
    } else {
      onFileChange?.(selected[0]);
    }
    resetInput();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    void selectFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const removeFile = (index: number) => {
    if (multiple) onFilesChange?.(files.filter((_, fileIndex) => fileIndex !== index));
    else onFileChange?.(null);
  };

  const selectedFiles = multiple ? files : file ? [file] : [];
  const preview = localAvatar ?? avatarPreview;

  return (
    <div className="chip-file-field" data-invalid={Boolean(error) || undefined} data-variant={variant}>
      {storedFile ? (
        <div className="chip-file-field__stored">
          <FileText aria-hidden="true" />
          <span className="chip-file-field__stored-copy">
            <span className="chip-file-field__stored-name">{storedFile.name}</span>
            {storedFile.size && <span className="chip-file-field__stored-size">{storedFile.size}</span>}
          </span>
          <span className="chip-file-field__stored-actions">
            {onDownload && <Button size="sm" variant="ghost" icon={<Download />} onClick={onDownload}>Скачать</Button>}
            <Button size="sm" variant="secondary" icon={<Upload />} onClick={() => inputRef.current?.click()} disabled={disabled}>Заменить</Button>
            {onDelete && <Button size="sm" variant="danger" icon={<Trash2 />} onClick={onDelete} disabled={disabled}>Удалить</Button>}
          </span>
        </div>
      ) : (
        <div
          className="chip-file-field__zone"
          data-disabled={disabled || undefined}
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {variant === 'avatar' ? (
            <span className="chip-file-field__avatar">
              {preview ? <img src={preview} alt="" /> : <span>{avatarFallback}</span>}
            </span>
          ) : <Upload className="chip-file-field__upload" aria-hidden="true" />}
          <span className="chip-file-field__copy">
            <span className="chip-file-field__label">{label}</span>
            {hint && <span id={hintId} className="chip-file-field__hint">{hint}</span>}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
            onClick={() => inputRef.current?.click()}
          >
            {variant === 'avatar' ? (preview ? 'Заменить фото' : 'Выбрать фото') : multiple ? 'Выбрать файлы' : 'Выбрать файл'}
          </Button>
        </div>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        data-chip-control=""
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="chip-file-field__input"
        tabIndex={-1}
        onChange={(event) => void selectFiles(Array.from(event.target.files ?? []))}
      />

      {selectedFiles.length > 0 && variant !== 'avatar' && (
        <div className="chip-file-field__selected-list" aria-label="Выбранные файлы">
          {selectedFiles.map((selected, index) => (
            <div className="chip-file-field__selected" key={`${selected.name}-${selected.lastModified}-${index}`}>
              <FileText aria-hidden="true" />
              <span>{selected.name}</span>
              <button
                type="button"
                data-chip-control=""
                className="chip-file-field__remove"
                disabled={disabled}
                aria-label={`Убрать файл ${selected.name}`}
                onClick={() => removeFile(index)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p id={errorId} className="chip-file-field__error" role="alert">{error}</p>}
    </div>
  );
}
