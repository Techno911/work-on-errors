import { Controller, Post, Get, Param, Body, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

// Иерархия ролей: приглашать можно только роль СТРОГО НИЖЕ своей (кроме суперадмина).
const ROLE_RANK: Record<string, number> = { manager: 1, reviewer: 2, owner: 3, tracker: 4, superadmin: 5 };

@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  // Право InviteUser есть у owner/reviewer/tracker/superadmin, НЕТ у manager → он отсечётся гардом.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.InviteUser)
  @Post()
  create(@Body() dto: CreateInviteDto, @CurrentUser() user: User) {
    // Non-superadmins can only create invites for their own company
    if (user.role !== UserRole.SUPERADMIN) {
      if (!user.companyId) throw new ForbiddenException();
      dto.companyId = user.companyId;
    }
    // Запрет эскалации привилегий: нельзя выписать себе (или кому-то) роль не ниже своей.
    const target = dto.role ?? 'manager';
    if (user.role !== UserRole.SUPERADMIN && (ROLE_RANK[target] ?? 99) >= (ROLE_RANK[user.role] ?? 0)) {
      throw new ForbiddenException('Нельзя пригласить пользователя с ролью не ниже своей');
    }
    return this.invitesService.create(dto, user.id);
  }

  @Get(':code')
  findByCode(@Param('code') code: string) {
    return this.invitesService.findByCodePublic(code);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':code/accept')
  accept(@Param('code') code: string, @CurrentUser() user: User) {
    return this.invitesService.accept(code, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findByCompany(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    // Non-superadmins can only list invites for their own company
    const effectiveCompanyId = user.role !== UserRole.SUPERADMIN
      ? user.companyId
      : (companyId ?? user.companyId);
    if (!effectiveCompanyId) throw new ForbiddenException();
    return this.invitesService.findByCompany(effectiveCompanyId);
  }
}
