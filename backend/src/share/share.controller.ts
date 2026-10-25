import { Controller, Get, Post, Delete, Param, Query, UseGuards, Res, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { Response } from 'express';
import { ShareService } from './share.service';
import { EntriesService } from '../entries/entries.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { emailColor } from '../mail/design-tokens';

@Controller('share')
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly entriesService: EntriesService,
  ) {}

  /**
   * POST /share/entry/:id — создать shareable-ссылку для записи (авторизованный).
   */
  @Post('entry/:id')
  @UseGuards(JwtAuthGuard)
  async createEntryShare(
    @Param('id', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: User,
  ) {
    // Company isolation
    const entry = await this.entriesService.findById(entryId);
    if (user.role !== UserRole.SUPERADMIN && entry.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    // Manager может расшарить только свои записи
    if (user.role === UserRole.MANAGER && entry.managerId !== user.id) {
      throw new ForbiddenException();
    }
    const token = await this.shareService.createToken(entryId, user.id);
    return { token };
  }

  /**
   * DELETE /share/entry/:id — отозвать все активные share-ссылки записи (SEC-5).
   * Те же права, что и на создание: суперадмин/своя компания, менеджер — только свою запись.
   */
  @Delete('entry/:id')
  @UseGuards(JwtAuthGuard)
  async revokeEntryShare(
    @Param('id', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: User,
  ) {
    const entry = await this.entriesService.findById(entryId);
    if (user.role !== UserRole.SUPERADMIN && entry.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    if (user.role === UserRole.MANAGER && entry.managerId !== user.id) {
      throw new ForbiddenException();
    }
    const revoked = await this.shareService.revokeForEntry(entryId);
    return { revoked };
  }

  /**
   * GET /share/entry?token=... — отдать HTML-отчёт (без авторизации, по токену).
   */
  @Get('entry')
  async getEntryByToken(@Query('token') token: string, @Res() res: Response) {
    if (!token) {
      res.status(400).send('token required');
      return;
    }
    try {
      const html = await this.shareService.getEntryHtml(token);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch {
      res.status(401).send(`
<!doctype html><html lang="ru"><head><meta charset="UTF-8"/><title>Ссылка недействительна</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px 20px;color:${emailColor('color-fg-subtle')};background:${emailColor('color-canvas')}}
h1{color:${emailColor('color-fg')};margin-bottom:12px}p{font-size:15px}</style></head>
<body><h1>Ссылка недействительна</h1>
<p>Срок действия ссылки истёк или она была отозвана.</p>
<p style="margin-top:20px"><a href="${process.env.APP_URL || 'https://app.example.invalid'}" style="color:${emailColor('color-accent-fg')}">На главную</a></p>
</body></html>`);
    }
  }
}
