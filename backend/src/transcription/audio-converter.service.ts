import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';

const execFileAsync = promisify(execFile);

// Ниже этого уровня разностный сигнал каналов считаем тишиной, то есть каналы одинаковые.
// Реальная запись двух собеседников даёт разность в районе -20 dB и выше, задублированное
// моно — около -91 dB (машинный ноль).
const DUAL_MONO_MAX_DB = -50;

/**
 * Подготовка аудио к транскрипции: длительность и число каналов через ffprobe, конвертация
 * в MP3 16 кГц (играет во всех браузерах, включая Safari).
 *
 * Про каналы. Телефония часто пишет разговор в стерео, разводя собеседников по каналам:
 * менеджер слева, клиент справа. Раньше мы всегда схлопывали запись в моно (`-ac 1`) и тем
 * самым уничтожали готовое, точное разделение говорящих, а потом просили нейросеть угадать
 * его заново. Теперь стерео с РАЗНЫМИ каналами сохраняем: провайдер распознаёт каналы
 * раздельно и собирает честный диалог. Задублированное стерео (в обоих каналах одно и то же)
 * схлопываем как раньше — иначе распознавание задвоило бы весь разговор.
 */
@Injectable()
export class AudioConverterService {
  private readonly logger = new Logger(AudioConverterService.name);

  async getDurationSec(path: string): Promise<number> {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
      { timeout: 30_000 },
    );
    const sec = parseFloat(stdout.trim());
    if (!isFinite(sec) || sec <= 0) {
      throw new Error('Не удалось определить длительность аудио');
    }
    return Math.round(sec);
  }

  /** Число аудиоканалов исходника. 0 = не удалось определить. */
  async getChannels(path: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels',
          '-of', 'default=noprint_wrappers=1:nokey=1', path],
        { timeout: 30_000 },
      );
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Настоящее ли это стерео (собеседники разведены по каналам) или просто продублированное
   * моно. Считаем разностный сигнал каналов и смотрим его пиковый уровень: у дубля разность
   * равна тишине. Ошибаемся в безопасную сторону — при любом сбое анализа отвечаем «нет»,
   * то есть идём прежним путём с моно.
   */
  async isTrueStereo(path: string): Promise<boolean> {
    if ((await this.getChannels(path)) !== 2) return false;
    try {
      const { stderr } = await execFileAsync(
        'ffmpeg',
        ['-v', 'info', '-i', path, '-af', 'pan=mono|c0=c0-c1,volumedetect', '-f', 'null', '-'],
        { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const m = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i.exec(stderr || '');
      if (!m) return false;
      const maxDb = parseFloat(m[1]);
      const trueStereo = isFinite(maxDb) && maxDb > DUAL_MONO_MAX_DB;
      this.logger.log(`Каналы записи: max разности ${maxDb} dB → ${trueStereo ? 'разные (стерео)' : 'одинаковые (моно)'}`);
      return trueStereo;
    } catch (err) {
      this.logger.warn(`Анализ каналов не удался, идём как моно: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Конвертация под распознавание. keepStereo=true сохраняет два канала (собеседники
   * разведены), иначе схлопывает в моно. Битрейт на стерео выше, иначе каждый канал получает
   * половину полосы и качество распознавания падает.
   */
  async convertForStt(src: string, dest: string, keepStereo: boolean): Promise<{ fileSize: number }> {
    const args = keepStereo
      ? ['-y', '-i', src, '-vn', '-ac', '2', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '96k', dest]
      : ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', dest];
    await execFileAsync('ffmpeg', args, { timeout: 300_000 });
    const { size } = await stat(dest);
    if (size === 0) throw new Error('Конвертация дала пустой файл');
    return { fileSize: size };
  }

  /** Разложить стереозапись на два моно-файла: канал 0 и канал 1 (говорящий 1 и говорящий 2). */
  async splitChannels(src: string, leftDest: string, rightDest: string): Promise<void> {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', src,
        '-filter_complex', '[0:a]channelsplit=channel_layout=stereo[l][r]',
        '-map', '[l]', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', leftDest,
        '-map', '[r]', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', rightDest],
      { timeout: 300_000 },
    );
  }
}
