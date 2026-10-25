import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetFirstStepsHiddenDto } from './dto/set-first-steps-hidden.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { isValidImageFile } from '../common/file-sniff.util';

/** Иерархия ролей для контроля эскалации при приглашении. */
function roleRank(role: UserRole): number {
  switch (role) {
    case UserRole.SUPERADMIN:
      return 4;
    case UserRole.OWNER:
      return 3;
    case UserRole.REVIEWER:
      return 2;
    case UserRole.MANAGER:
      return 1;
    default:
      return 0;
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(Permission.ReadUser)
  async findAll(@Query('companyId') companyId?: string, @CurrentUser() currentUser?: User) {
    // TRACKER кросс-tenant по дизайну (ведёт онбординг всех компаний, companyId у него null) —
    // остальным ролям пустой companyId запрещает доступ, а не отдаёт «все компании» по умолчанию.
    // Раньше пользователь без привязки к компании (например, до её назначения после
    // self-регистрации) получал `findAll(undefined)` и видел пользователей ВСЕХ компаний.
    if (currentUser && currentUser.role !== UserRole.SUPERADMIN && currentUser.role !== UserRole.TRACKER) {
      if (!currentUser.companyId) throw new ForbiddenException();
      if (companyId && companyId !== currentUser.companyId) throw new ForbiddenException();
      return this.usersService.findAll(currentUser.companyId);
    }
    return this.usersService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions(Permission.ReadUser)
  async findById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser: User) {
    const target = await this.usersService.findById(id);
    if (currentUser.role !== UserRole.SUPERADMIN && target.companyId !== currentUser.companyId) {
      throw new ForbiddenException();
    }
    return target;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: User,
  ) {
    const isSelf = id === currentUser.id;
    const isSuperadmin = currentUser.role === UserRole.SUPERADMIN;
    const isOwner = currentUser.role === UserRole.OWNER;
    if (!isSelf && !isSuperadmin && !isOwner) throw new ForbiddenException();
    // Owners can only admin-update users within their own company
    if (isOwner && !isSelf) {
      const targetUser = await this.usersService.findById(id);
      if (targetUser.companyId !== currentUser.companyId) throw new ForbiddenException();
    }
    // Смена role/isActive: superadmin — без ограничений; owner — только ЧУЖИМ в своей компании
    // и только на непривилегированные роли (manager/reviewer), никогда себе и никогда до owner/
    // superadmin/tracker (иначе owner одним PATCH эскалирует себя до суперадмина). Остальным — снимаем поля.
    if (!isSuperadmin) {
      if (isOwner && !isSelf) {
        if (dto.role !== undefined && dto.role !== UserRole.MANAGER && dto.role !== UserRole.REVIEWER) {
          throw new ForbiddenException('Недостаточно прав для назначения этой роли');
        }
      } else {
        delete dto.role;
        delete dto.isActive;
      }
    }
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.DeleteUser)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser: User) {
    if (currentUser.role !== UserRole.SUPERADMIN) {
      const targetUser = await this.usersService.findById(id);
      if (targetUser.companyId !== currentUser.companyId) throw new ForbiddenException();
    }
    return this.usersService.remove(id);
  }

  @Delete(':id/hard')
  @RequirePermissions(Permission.DeleteUser)
  async hardDelete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser: User) {
    if (id === currentUser.id) throw new ForbiddenException('Нельзя удалить самого себя');
    if (currentUser.role !== UserRole.SUPERADMIN) {
      const targetUser = await this.usersService.findById(id);
      if (targetUser.companyId !== currentUser.companyId) throw new ForbiddenException();
    }
    await this.usersService.hardDelete(id);
    return { message: 'Пользователь полностью удалён' };
  }

  @Post(':id/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'avatars');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          // Расширение НАЗНАЧАЕМ по mime, НЕ берём из originalname: иначе .html/.js/.svg
          // сохранился бы на публичной статике и исполнился в origin (stored-XSS, захват аккаунта).
          const AV_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
          cb(null, `${unique}${AV_EXT[file.mimetype] ?? '.png'}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        // Только растровые картинки: svg (может содержать скрипт), html, js — запрещены.
        const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];
        if (!ALLOWED.includes(file.mimetype)) {
          return cb(new BadRequestException('Только изображения PNG, JPEG или WebP'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  async uploadAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: User,
  ) {
    if (!file) throw new BadRequestException('Файл не загружен');
    const isSelf = id === currentUser.id;
    const isAdmin = currentUser.role === UserRole.SUPERADMIN || currentUser.role === UserRole.OWNER;
    if (!isSelf && !isAdmin) throw new ForbiddenException();
    // AUDIT-0710 (L3): сверяем реальные байты файла — метка Content-Type клиенту подконтрольна.
    const avatarPath = join(process.cwd(), 'uploads', 'avatars', file.filename);
    if (!isValidImageFile(avatarPath)) {
      try { fs.unlinkSync(avatarPath); } catch { /* файл уже отсутствует — не критично */ }
      throw new BadRequestException('Файл не является изображением (PNG, JPEG или WebP)');
    }
    return this.usersService.uploadAvatar(id, file.filename);
  }

  @Post('invite')
  @RequirePermissions(Permission.InviteUser)
  async invite(@Body() dto: InviteUserDto, @CurrentUser() currentUser: User) {
    // Superadmin может приглашать в любую компанию с любой ролью.
    // Все остальные: companyId форсится своим (запрет межтенантного создания),
    // роль не может быть выше собственной (запрет эскалации до owner/superadmin).
    if (currentUser.role !== UserRole.SUPERADMIN) {
      if (!currentUser.companyId) throw new ForbiddenException();
      dto.companyId = currentUser.companyId;
      if (roleRank(dto.role) > roleRank(currentUser.role)) {
        throw new ForbiddenException('Нельзя пригласить пользователя с ролью выше своей');
      }
    }
    return this.usersService.invite(dto);
  }

  @Post('me/password')
  async changeMyPassword(
    @CurrentUser() user: User,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    await this.usersService.changePassword(user.id, body.currentPassword ?? '', body.newPassword ?? '');
    return { changed: true };
  }

  @Post('me/onboarding-seen')
  async markOnboardingSeen(@CurrentUser() currentUser: User) {
    return this.usersService.update(currentUser.id, {
      onboardingSeenAt: new Date(),
    } as UpdateUserDto);
  }

  @Post('me/onboarding-reset')
  async resetOnboarding(@CurrentUser() currentUser: User) {
    return this.usersService.update(currentUser.id, {
      onboardingSeenAt: null,
    } as UpdateUserDto);
  }

  /**
   * Личное скрытие/возврат учебной карточки «Первые шаги». Отдельный узкий endpoint:
   * только текущий пользователь по токену, только {hidden: boolean}. Поле сознательно
   * отсутствует в UpdateUserDto — иначе чужую настройку сбрасывали бы через PATCH /users/:id.
   */
  @Post('me/first-steps-hidden')
  async setFirstStepsHidden(
    @CurrentUser() currentUser: User,
    @Body() body: SetFirstStepsHiddenDto,
  ) {
    return this.usersService.setFirstStepsHidden(currentUser.id, body.hidden);
  }

  /**
   * «Что нового» прочитано до версии X. Формат версии проверяем здесь же: в колонку не должно
   * попасть ничего, кроме X.Y.Z, иначе сравнение с реестром анонсов на фронте начнёт врать молча.
   */
  @Post('me/releases-seen')
  async markReleasesSeen(
    @CurrentUser() currentUser: User,
    @Body() body: { version?: string },
  ) {
    const version = (body?.version ?? '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new BadRequestException('Ожидается версия в формате X.Y.Z');
    }
    return this.usersService.markReleasesSeen(currentUser.id, version);
  }

  /**
   * Личное согласие сотрудника на ПДн (ст. 88 ТК РФ) + ознакомление с ЛНА (ст. 86 ч. 8 ТК РФ) —
   * два САМОСТОЯТЕЛЬНЫХ акта, оба обязательны. Работодатель не может дать это согласие за
   * работника — экран на первом входе, сам сотрудник под своим логином.
   */
  @Post('me/pdn-consent')
  async submitPdnConsent(
    @CurrentUser() currentUser: User,
    @Body() body: { pdnConsent: boolean; lnaAcknowledged: boolean },
    @Req() req: Request,
  ) {
    if (!body.pdnConsent || !body.lnaAcknowledged) {
      throw new BadRequestException('Требуется подтвердить оба пункта: согласие на ПДн и ознакомление с положением');
    }
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
    return this.usersService.recordPdnConsent(currentUser.id, ip);
  }
}
