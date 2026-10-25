import * as fs from 'fs';

/**
 * AUDIT-0710 (L3): fileFilter верил client-supplied `file.mimetype` — SVG с меткой
 * image/png принимался и ложился в хранилище. Сверяем реальную сигнатуру первых
 * байт файла (тот же приём, что SEC-4 у договоров: isValidContractFile в admin.service).
 */

const IMAGE_MAGIC_BYTES: Record<string, Buffer[]> = {
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/webp': [Buffer.from('RIFF', 'ascii')], // + 'WEBP' на смещении 8 — см. проверку ниже
};

function readHead(filePath: string, len: number): Buffer | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n);
  } catch {
    return null;
  }
}

/** Сохранённый файл действительно картинка заявленного (или любого разрешённого) типа. */
export function isValidImageFile(filePath: string): boolean {
  const head = readHead(filePath, 16);
  if (!head || head.length < 4) return false;
  if (head.subarray(0, 8).equals(IMAGE_MAGIC_BYTES['image/png'][0])) return true;
  if (head.subarray(0, 3).equals(IMAGE_MAGIC_BYTES['image/jpeg'][0])) return true;
  // WebP: RIFF....WEBP
  if (head.length >= 12 && head.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii'))
      && head.subarray(8, 12).equals(Buffer.from('WEBP', 'ascii'))) return true;
  return false;
}

/** Аудио: MP3 (ID3 / frame sync), WAV (RIFF..WAVE), OGG, M4A/MP4 (ftyp), FLAC. */
export function isValidAudioFile(filePath: string): boolean {
  const head = readHead(filePath, 16);
  if (!head || head.length < 4) return false;
  if (head.subarray(0, 3).equals(Buffer.from('ID3', 'ascii'))) return true;
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true; // MP3 frame sync
  if (head.length >= 12 && head.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii'))
      && head.subarray(8, 12).equals(Buffer.from('WAVE', 'ascii'))) return true;
  if (head.subarray(0, 4).equals(Buffer.from('OggS', 'ascii'))) return true;
  if (head.length >= 8 && head.subarray(4, 8).equals(Buffer.from('ftyp', 'ascii'))) return true;
  if (head.subarray(0, 4).equals(Buffer.from('fLaC', 'ascii'))) return true;
  return false;
}
