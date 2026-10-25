import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { EntriesService } from '../entries/entries.service';
import { ShareToken } from './entities/share-token.entity';
import { redactPii } from '../common/pii-redact.util';
import { emailColor } from '../mail/design-tokens';

interface ShareTokenPayload {
  type: 'entry-share';
  entryId: string;
  issuedBy: string;
  jti: string;
}

@Injectable()
export class ShareService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly entriesService: EntriesService,
    @InjectRepository(ShareToken)
    private readonly shareTokenRepo: Repository<ShareToken>,
  ) {}

  /**
   * Создать shareable-токен для записи. Действует 30 дней, отзываем по jti (SEC-5).
   * Ссылка: https://<APP_URL>/api/share/entry?token=...
   */
  async createToken(entryId: string, issuedById: string): Promise<string> {
    // Проверим, что запись существует
    await this.entriesService.findById(entryId);

    const jti = randomUUID();
    await this.shareTokenRepo.save({ id: jti, entryId, issuedBy: issuedById, revokedAt: null });

    const payload: ShareTokenPayload = {
      type: 'entry-share',
      entryId,
      issuedBy: issuedById,
      jti,
    };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '30d',
    });
  }

  /** Отозвать все активные share-ссылки записи (владелец компании/менеджер/суперадмин). */
  async revokeForEntry(entryId: string): Promise<number> {
    const result = await this.shareTokenRepo.update({ entryId }, { revokedAt: new Date() });
    return result.affected ?? 0;
  }

  async verifyToken(token: string): Promise<ShareTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<ShareTokenPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      if (payload.type !== 'entry-share') {
        throw new UnauthorizedException('Invalid token type');
      }
      // Легаси-токены без jti (выпущены до SEC-5) — считаем недействительными, а не «доверяем навсегда».
      if (!payload.jti) {
        throw new UnauthorizedException('Ссылка выпущена старой версией — создайте новую');
      }
      const record = await this.shareTokenRepo.findOne({ where: { id: payload.jti } });
      if (!record || record.revokedAt) {
        throw new UnauthorizedException('Ссылка отозвана');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Ссылка недействительна или истекла');
    }
  }

  async getEntryHtml(token: string): Promise<string> {
    const payload = await this.verifyToken(token);
    const entry = await this.entriesService.findById(payload.entryId);
    if (!entry) throw new NotFoundException();
    return this.renderHtml(entry);
  }

  private renderHtml(entry: {
    id: string;
    entryNumber: number;
    entryDate: string;
    type: string;
    source: string | null;
    sourceCustom: string | null;
    selfReviewCorrect: string | null;
    selfReviewImprove: string | null;
    selfReviewSuggestions: string | null;
    reviewText: string | null;
    reviewedAt: Date | null;
    transcription: string | null;
    manager: { fullName: string } | null;
    reviewer: { fullName: string } | null;
    errorTags: Array<{ name: string; color: string | null }>;
  }): string {
    const escape = (s: string | null | undefined): string => {
      if (!s) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    const nl2br = (s: string | null | undefined): string =>
      escape(s).replace(/\n/g, '<br/>');

    /**
     * Персональные данные скрываются ПЕРЕД экранированием: по этой ссылке ходит человек без
     * учётной записи, и ссылку пересылают дальше. Внутри платформы такое же правило уже
     * действует для доказательств методички (redactPii в playbook-detection), а наружу
     * расшифровка звонка уходила сырой, с телефонами и отчествами клиентов, хотя это самый
     * открытый выход данных из системы (разбор 09.08.2026). Телефон, почта, номер карты,
     * документ и «Имя Отчество» заменяются подписями.
     */
    const publicText = (s: string | null | undefined): string =>
      s ? nl2br(redactPii(s)) : '';

    const entryTypeLabel = entry.type === 'call' ? 'Звонок' : 'Переписка';
    const source = entry.sourceCustom || entry.source || '—';
    const date = new Date(entry.entryDate).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    const tags = (entry.errorTags ?? [])
      .map(t => `<span class="tag" style="background:${escape(t.color ?? emailColor('color-border'))}20;color:${escape(t.color ?? emailColor('color-fg-subtle'))};border:1px solid ${escape(t.color ?? emailColor('color-border'))}40">${escape(t.name)}</span>`)
      .join('');

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow, noarchive"/>
  <meta name="referrer" content="no-referrer"/>
  <title>Разбор записи #${entry.entryNumber} — Чирков и Партнёры</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, 'Source Sans 3', sans-serif;
      background: ${emailColor('color-canvas')};
      color: ${emailColor('color-fg')};
      padding: 40px 20px;
      line-height: 1.55;
      font-size: 15px;
    }
    .container { max-width: 820px; margin: 0 auto; background: ${emailColor('color-surface')}; border-radius: 16px; border: 1px solid ${emailColor('color-border')}; overflow: hidden; }
    .header { background: linear-gradient(135deg, ${emailColor('color-accent')} 0%, ${emailColor('color-accent-hover')} 100%); color: ${emailColor('color-on-inverse')}; padding: 32px 40px; }
    .brand { font-size: 13px; opacity: 0.75; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 6px; font-weight: 600; }
    h1 { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { opacity: 0.85; font-size: 15px; }
    .content { padding: 32px 40px; }
    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 20px; padding: 16px 20px; background: ${emailColor('color-accent-subtle')}; border: 1px solid ${emailColor('color-accent-muted')}; border-radius: 12px; margin-bottom: 24px; font-size: 13px; }
    .meta-item span:first-child { color: ${emailColor('color-fg-subtle')}; display: block; margin-bottom: 2px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .meta-item span:last-child { color: ${emailColor('color-fg')}; font-weight: 600; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 13px; text-transform: uppercase; color: ${emailColor('color-fg-subtle')}; letter-spacing: 0.06em; font-weight: 700; margin-bottom: 10px; }
    .section-body { background: ${emailColor('color-canvas')}; border: 1px solid ${emailColor('color-border')}; border-radius: 12px; padding: 14px 18px; white-space: pre-wrap; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { font-size: 12px; padding: 4px 10px; border-radius: 999px; font-weight: 500; }
    .empty { color: ${emailColor('color-fg-disabled')}; font-style: italic; font-size: 13px; }
    .footer { padding: 20px 40px; background: ${emailColor('color-canvas')}; border-top: 1px solid ${emailColor('color-border')}; color: ${emailColor('color-fg-disabled')}; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
    .print-btn { background: ${emailColor('color-accent')}; color: ${emailColor('color-on-inverse')}; border: none; padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .print-btn:hover { background: ${emailColor('color-accent-hover')}; }
    @media print {
      body { padding: 0; background: ${emailColor('color-surface')}; }
      .container { border: none; border-radius: 0; box-shadow: none; }
      .footer .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">Чирков и Партнёры</div>
      <h1>${entryTypeLabel} №${entry.entryNumber} · ${escape(entry.manager?.fullName ?? '—')}</h1>
      <div class="subtitle">${escape(date)} · источник: ${escape(source)}</div>
    </div>
    <div class="content">
      <div class="meta">
        <div class="meta-item"><span>Менеджер</span><span>${escape(entry.manager?.fullName ?? '—')}</span></div>
        <div class="meta-item"><span>Проверяющий</span><span>${escape(entry.reviewer?.fullName ?? 'ещё не проверено')}</span></div>
        <div class="meta-item"><span>Дата события</span><span>${escape(date)}</span></div>
        <div class="meta-item"><span>Дата проверки</span><span>${entry.reviewedAt ? escape(new Date(entry.reviewedAt).toLocaleDateString('ru-RU')) : '—'}</span></div>
      </div>

      ${entry.transcription ? `<div class="section"><h2>Фактура</h2><div class="section-body">${publicText(entry.transcription)}</div></div>` : ''}

      <div class="section">
        <h2>Самоанализ менеджера</h2>
        <div class="section-body">
          <strong style="color:${emailColor('color-success')}">Что получилось:</strong><br/>
          ${publicText(entry.selfReviewCorrect) || '<span class="empty">не заполнено</span>'}
          <br/><br/>
          <strong style="color:${emailColor('color-accent-fg')}">Что можно улучшить:</strong><br/>
          ${publicText(entry.selfReviewImprove) || '<span class="empty">не заполнено</span>'}
          ${entry.selfReviewSuggestions ? `<br/><br/><strong style="color:${emailColor('color-info')}">Предложения:</strong><br/>${publicText(entry.selfReviewSuggestions)}` : ''}
        </div>
      </div>

      ${entry.errorTags && entry.errorTags.length > 0 ? `<div class="section"><h2>Выявленные ошибки</h2><div class="tags">${tags}</div></div>` : ''}

      ${entry.reviewText ? `<div class="section"><h2>Ревью руководителя</h2><div class="section-body">${publicText(entry.reviewText)}</div></div>` : ''}
    </div>
    <div class="footer">
      <span>Разбор сгенерирован платформой «Работа над ошибками»</span>
      <button class="print-btn" onclick="window.print()">Распечатать / Сохранить PDF</button>
    </div>
  </div>
</body>
</html>`;
  }
}
