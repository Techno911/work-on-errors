import { useState } from 'react';
import { FileField } from '@chirkov/shell';

const ACCEPT = '.mp3,.wav,.m4a,.ogg,audio/*';
const MAX_SIZE = 200 * 1024 * 1024;

/** Загрузка одного аудиофайла записи звонка. Зона, выбранный файл и «убрать» рисует FileField пакета. */
export function AudioDropzone({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const [sizeError, setSizeError] = useState('');

  const pick = (f: File | null) => {
    if (f && f.size > MAX_SIZE) {
      setSizeError('Файл больше 200 МБ. Обрежьте запись или сожмите в MP3.');
      return;
    }
    setSizeError('');
    onChange(f);
  };

  return (
    <FileField
      label="Запись звонка"
      hint="MP3, WAV, M4A или OGG · до 200 МБ"
      accept={ACCEPT}
      file={file}
      onFileChange={pick}
      error={sizeError || undefined}
    />
  );
}
