import {
  ParseUUIDPipe,
  Controller, Get, Post, Patch, Delete, Param, Query, Body, Res,
  UseGuards, UseInterceptors, UploadedFiles, ForbiddenException, StreamableFile,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import type { Response } from 'express';
import { EntriesService } from './entries.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { UpdateEntryDto } from './dto/update-entry.dto';
import { ReviewEntryDto } from './dto/review-entry.dto';
import { ReviewConfirmDto } from './dto/review-confirm.dto';
import { SetTagsDto } from './dto/set-tags.dto';
import { EntryStatus } from './enums/entry-status.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

// Расширение сохраняемого скриншота — по сниффнутому mimetype (белый список), не по имени
// файла от клиента. Совпадает с тем, что getScreenshotFile умеет отдавать по расширению.
const SCREENSHOT_EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

@Controller('entries')
@UseGuards(JwtAuthGuard)
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  findAll(
    @CurrentUser() user: User,
    @Query('sprintId') sprintId?: string,
    @Query('managerId') managerId?: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: EntryStatus,
  ) {
    // Non-superadmins can only query their own company's entries
    const effectiveCompanyId =
      user.role !== UserRole.SUPERADMIN ? (user.companyId ?? companyId) : companyId;
    if (user.role !== UserRole.SUPERADMIN && companyId && companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    // Managers can only see their own entries
    const effectiveManagerId = user.role === UserRole.MANAGER ? user.id : managerId;
    return this.entriesService.findAll(sprintId, effectiveManagerId, effectiveCompanyId ?? undefined, status);
  }

  @Get('recent-reviews')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  getRecentReviews(
    @Query('managerId') managerId: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string | undefined,
    @Query('order') order: string | undefined,
    @Query('requireText') requireText: string | undefined,
    @CurrentUser() user: User,
  ) {
    // Reviewers/owners/superadmins can query any manager; managers only see themselves
    const isReviewer = user.role === UserRole.REVIEWER || user.role === UserRole.OWNER || user.role === UserRole.SUPERADMIN;
    const effectiveManagerId = isReviewer ? (managerId ?? user.id) : user.id;
    // Company-изоляция: не-superadmin видит записи только своей компании, даже подставив чужой managerId
    const scopeCompanyId = user.role === UserRole.SUPERADMIN ? undefined : (user.companyId ?? undefined);
    return this.entriesService.getRecentReviews(effectiveManagerId, parseInt(limit) || 3, scopeCompanyId, {
      offset: Math.max(parseInt(offset ?? '0') || 0, 0),
      orderBy: order === 'reviewedAt' ? 'reviewedAt' : undefined,
      requireText: requireText === 'true',
    });
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.entriesService.findById(id, user.companyId ?? undefined, ownerId);
  }

  // Повторы ошибок этого менеджера: «эта ошибка у него третий раз за шесть недель».
  // Право SubmitReview, а не ReadEntry: сводка по прошлым разборам человека нужна тому,
  // кто пишет разбор, и не предназначена самому менеджеру в такой форме.
  @Get(':id/repeats')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.SubmitReview)
  repeats(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.entriesService.getManagerRepeats(id, user.companyId ?? undefined);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.CreateEntry)
  create(@Body() dto: CreateEntryDto, @CurrentUser() user: User) {
    // Force company isolation: non-superadmins can only create in their own company
    if (user.role !== UserRole.SUPERADMIN && user.companyId) {
      dto.companyId = user.companyId;
    }
    // Managers can only create entries for themselves
    if (user.role === UserRole.MANAGER) {
      dto.managerId = user.id;
    }
    return this.entriesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateEntry)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEntryDto, @CurrentUser() user: User) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.entriesService.update(id, dto, user.companyId ?? undefined, ownerId);
  }

  @Patch(':id/submit')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateEntry)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.entriesService.submit(id, user.companyId ?? undefined, ownerId);
  }

  @Patch(':id/review')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.SubmitReview)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.entriesService.review(id, dto, user.id, user.companyId ?? undefined);
  }

  /**
   * Личная отметка чтения разбора (review-reread-confirm). Автор — только сам
   * менеджер-владелец записи; в «Глазами» серверный 403 (claim imp в токене),
   * в теле — только хеш прочитанной версии.
   */
  @Patch(':id/review-confirm')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  async confirmReview(
    @Param('id') id: string,
    @Body() dto: ReviewConfirmDto,
    @CurrentUser() user: User & { impersonated?: boolean },
  ) {
    if (user.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Отметка ставится только менеджером у своего разбора');
    }
    if (user.impersonated) {
      throw new ForbiddenException('Личная отметка в режиме «Глазами» недоступна');
    }
    return this.entriesService.confirmReview(id, dto, user);
  }

  @Patch(':id/tags')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.TagErrors)
  setTags(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTagsDto, @CurrentUser() user: User) {
    return this.entriesService.setTags(id, dto.tagIds, user.companyId ?? undefined);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.DeleteEntry)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.entriesService.remove(id, user.companyId ?? undefined, user.role);
  }

  @Post(':id/screenshots')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateEntry)
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'screenshots');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          // Расширение — из сниффнутого mimetype, а не из client-supplied originalname:
          // multer/busboy пропускает произвольные байты в имени файла, а метаданные
          // Content-Disposition раньше попадали в команду OCR как есть (была RCE).
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = SCREENSHOT_EXT_BY_MIME[file.mimetype] ?? '.jpg';
          cb(null, `${unique}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!(file.mimetype in SCREENSHOT_EXT_BY_MIME)) {
          return cb(new Error('Only images are allowed'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadScreenshots(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: User,
  ) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.entriesService.addScreenshots(id, files, user.companyId ?? undefined, ownerId);
  }

  @Delete(':id/screenshots/:screenshotId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateEntry)
  removeScreenshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('screenshotId', ParseUUIDPipe) screenshotId: string,
    @CurrentUser() user: User,
  ) {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    return this.entriesService.removeScreenshot(id, screenshotId, user.companyId ?? undefined, ownerId);
  }

  /**
   * Авторизованная отдача скриншота переписки (ПД клиента). Заменяет публичную раздачу /uploads.
   */
  @Get(':id/screenshots/:screenshotId/file')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  async getScreenshotFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('screenshotId', ParseUUIDPipe) screenshotId: string,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const ownerId = user.role === UserRole.MANAGER ? user.id : undefined;
    const { absPath } = await this.entriesService.resolveScreenshotFile(
      id, screenshotId, user.companyId ?? undefined, ownerId,
    );
    const ext = extname(absPath).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(fs.createReadStream(absPath));
  }
}
