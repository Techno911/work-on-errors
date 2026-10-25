import { useCallback, useEffect, useState } from 'react';
import { Button, FileField } from '@chirkov/shell';

interface ImageDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  maxFiles?: number;
}

export function ImageDropzone({ files, onChange, maxFiles = 10 }: ImageDropzoneProps) {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [files]);

  const addFiles = useCallback((newFiles: File[]) => {
    const imageFiles = newFiles.filter(f => f.type.startsWith('image/'));
    onChange([...files, ...imageFiles].slice(0, maxFiles));
  }, [files, maxFiles, onChange]);

  // Ctrl+V со скриншотом ловим на документе: скрытое поле FileField не берёт фокус, а вставка
  // текста в соседние поля формы не затрагивается (реагируем только на картинки в буфере).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imageFiles = Array.from(e.clipboardData?.items ?? [])
        .filter(item => item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (imageFiles.length > 0) addFiles(imageFiles);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const removeFile = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <FileField
        label="Скриншоты"
        hint={`Только изображения (JPG, PNG), до 10 МБ каждое, максимум ${maxFiles} файлов. Можно вставить Ctrl+V`}
        accept="image/*"
        multiple
        onFilesChange={addFiles}
      />

      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {files.map((file, index) => (
            <div key={index} className="relative group aspect-square">
              <img
                src={previewUrls[index]}
                alt={file.name}
                loading="lazy"
                className="w-full h-full object-cover rounded-card border border-border"
              />
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  type="button"
                  onClick={() => removeFile(index)}
                  variant="ghost"
                  size="sm"
                  aria-label={`Удалить скриншот ${file.name}`}
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
