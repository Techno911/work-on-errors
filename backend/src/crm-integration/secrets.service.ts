import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * AES-256-GCM для секретов CRM-подключений. Ключ — CRM_ENCRYPTION_KEY из env
 * (любая строка ≥16 символов; до 32 байт доводится через SHA-256).
 * Формат: v1:<iv>:<authTag>:<ciphertext> (base64) — префикс версии на будущую ротацию.
 */
@Injectable()
export class SecretsService {
  private get key(): Buffer {
    const raw = process.env.CRM_ENCRYPTION_KEY ?? '';
    if (raw.length < 16) {
      throw new Error('CRM_ENCRYPTION_KEY не задан или короче 16 символов');
    }
    return createHash('sha256').update(raw).digest();
  }

  get configured(): boolean {
    return (process.env.CRM_ENCRYPTION_KEY ?? '').length >= 16;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(stored: string): string {
    const [version, ivB64, tagB64, dataB64] = stored.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Неизвестный формат зашифрованного секрета');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Маска для UI: последние 4 символа. */
  mask(plain: string): string {
    return `•••${plain.slice(-4)}`;
  }
}
