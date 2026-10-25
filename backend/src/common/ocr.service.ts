import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  /**
   * Распознать текст с изображения через Tesseract.
   * Работает с русским + английским языками.
   * Возвращает распознанный текст; `null` — распознавание не выполнилось
   * (нет модели, битый файл), `''` — OCR отработал, но текст не найден.
   * AUDIT-0710: раньше ошибка и «текста нет» выглядели одинаково — фича молчала.
   */
  async recognizeText(imagePath: string): Promise<string | null> {
    try {
      if (!fs.existsSync(imagePath)) {
        this.logger.warn(`OCR: файл не найден: ${imagePath}`);
        return null;
      }

      // execFile, не exec: путь идёт отдельным аргументом argv, не строкой шелла — имя
      // загруженного файла не может внести кавычки/`;`/`$()` в команду (было RCE через
      // originalname загружаемого скриншота).
      // -l rus+eng — русский и английский
      // --psm 6 — предполагаем единый блок текста
      const { stdout } = await execFileAsync(
        'tesseract',
        [imagePath, 'stdout', '-l', 'rus+eng', '--psm', '6'],
        { timeout: 30000 },
      );

      const text = stdout.trim();
      this.logger.log(`OCR: распознано ${text.length} символов из ${imagePath}`);
      return text;
    } catch (error) {
      this.logger.error(`OCR ошибка для ${imagePath}: ${(error as Error).message}`);
      return null;
    }
  }
}
