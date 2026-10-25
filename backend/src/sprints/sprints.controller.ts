import {
  ParseUUIDPipe, Controller, Get, Post, Patch, Param, Query, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

function assertCompanyAccess(user: User, requestedCompanyId: string): void {
  if (user.role !== UserRole.SUPERADMIN && user.companyId !== requestedCompanyId) {
    throw new ForbiddenException();
  }
}

@Controller('sprints')
@UseGuards(JwtAuthGuard)
export class SprintsController {
  constructor(private readonly sprintsService: SprintsService) {}

  @Get('current')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  getCurrent(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.sprintsService.getOrCreateCurrent(companyId);
  }

  @Get('history')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  getHistory(
    @Query('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    assertCompanyAccess(user, companyId);
    return this.sprintsService.getHistory(companyId, parseInt(page, 10), parseInt(limit, 10));
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  findAll(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.sprintsService.findAll(companyId);
  }

  @Get(':sprintId/progress')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  getProgress(
    @Param('sprintId') sprintId: string,
    @Query('managerId') managerId: string,
    @CurrentUser() user: User,
  ) {
    const companyId = user.role !== UserRole.SUPERADMIN ? (user.companyId ?? undefined) : undefined;
    // Manager ownership: менеджер видит только свой прогресс (query managerId игнорируется).
    const effectiveManagerId = user.role === UserRole.MANAGER ? user.id : managerId;
    return this.sprintsService.getProgress(sprintId, effectiveManagerId, companyId);
  }

  @Get(':sprintId/team-progress')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  getTeamProgress(@Param('sprintId') sprintId: string, @CurrentUser() user: User) {
    const companyId = user.role !== UserRole.SUPERADMIN ? (user.companyId ?? undefined) : undefined;
    return this.sprintsService.getTeamProgress(sprintId, companyId);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const companyId = user.role !== UserRole.SUPERADMIN ? (user.companyId ?? undefined) : undefined;
    return this.sprintsService.findById(id, companyId);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.CreateSprint)
  create(@Body() dto: CreateSprintDto, @CurrentUser() user: User) {
    assertCompanyAccess(user, dto.companyId);
    return this.sprintsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.UpdateSprint)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSprintDto, @CurrentUser() user: User) {
    const companyId = user.role !== UserRole.SUPERADMIN ? (user.companyId ?? undefined) : undefined;
    return this.sprintsService.update(id, dto, companyId);
  }
}
