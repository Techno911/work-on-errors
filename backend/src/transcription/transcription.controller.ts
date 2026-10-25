import {
  ParseUUIDPipe,
  Controller, Get, Post, Delete, Param, Query, Req, Res,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import type { Request, Response } from 'express';
import { TranscriptionService } from './transcription.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.ogg'];

/** Аудио к записи: загрузка, статус транскрипции, явное применение, удаление. */
@Controller('entries')
@UseGuards(JwtAuthGuard)
export class TranscriptionEntriesController {
  constructor(private readonly transcriptionService: TranscriptionService) {}

  @Post(':id/audio')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateEntry)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'audio', 'staging');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        // m4a часто приходит как video/mp4 или octet-stream — пропускаем по расширению
        const ext = extname(file.originalname).toLowerCase();
        if (file.mimetype.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) {
          return cb(null, true);
        }
        cb(new Error('Можно загрузить только аудиофайл: MP3, WAV, M4A или OGG'), false);
      },
      limits: { fileSize: 200 * 1024 * 1024 }, // 200 МБ — час телефонного WAV проходит
    }),
  )
  uploadAudio(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    if (!file) throw new BadRequestException('Файл не получен');
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.transcriptionService.uploadAudio(id, file, user.companyId ?? undefined, ownerId);
  }

  @Get(':id/audio')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  getAudio(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.transcriptionService.getForEntry(id, user.companyId ?? undefined, ownerId);
  }

  /**
   * Авторизованный стрим записи звонка (ПД клиента). Заменяет публичную раздачу /uploads.
   * Поддерживает HTTP Range — нужно для перемотки в <audio>.
   */
  @Get(':id/audio/stream')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  async streamAudio(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    const { absPath, size } = await this.transcriptionService.resolveAudioFile(
      id, user.companyId ?? undefined, ownerId,
    );

    const total = fs.statSync(absPath).size; // фактический размер на диске — источник истины для Range
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : total - 1;
      if (start >= total || end >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(absPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', size || total);
    fs.createReadStream(absPath).pipe(res);
  }

  @Post(':id/audio/apply')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateEntry)
  applyTranscription(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.transcriptionService.applyToEntry(id, user.companyId ?? undefined, ownerId);
  }

  @Delete(':id/audio')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateEntry)
  removeAudio(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.transcriptionService.removeAudio(id, user.companyId ?? undefined, ownerId);
  }
}

/** Расход минут транскрипции — владелец видит свой, superadmin любой через ?companyId. */
@Controller('transcription')
@UseGuards(JwtAuthGuard)
export class TranscriptionController {
  constructor(private readonly transcriptionService: TranscriptionService) {}

  @Get('usage')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateCompany)
  getUsage(@CurrentUser() user: User, @Query('companyId') companyId?: string) {
    const effective = user.role === UserRole.SUPERADMIN ? (companyId ?? user.companyId) : user.companyId;
    if (!effective) throw new BadRequestException('companyId обязателен');
    if (user.role !== UserRole.SUPERADMIN && companyId && companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return this.transcriptionService.getMonthUsage(effective);
  }

  /**
   * Лёгкий остаток минут для менеджера: показать предупреждение/дизейбл таба
   * «Аудиофайл» ДО загрузки файла с телефона. Всегда своя компания.
   */
  @Get('my/usage')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.CreateEntry)
  getMyUsage(@CurrentUser() user: User) {
    if (!user.companyId) throw new BadRequestException('Пользователь не привязан к компании');
    return this.transcriptionService.getMonthUsage(user.companyId);
  }
}
