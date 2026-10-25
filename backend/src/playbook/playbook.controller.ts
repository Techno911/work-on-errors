import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { PlaybookService } from './playbook.service';
import { ConfirmCandidateDto } from './dto/confirm-candidate.dto';
import { DismissCardDto } from './dto/dismiss-card.dto';
import { UpdatePlaybookCardDto, CreateManualCardDto } from './dto/update-playbook-card.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

function assertSameCompany(user: User, companyId: string): void {
  if (user.role !== UserRole.SUPERADMIN && user.companyId !== companyId) {
    throw new ForbiddenException();
  }
}

@Controller('playbook')
@UseGuards(JwtAuthGuard)
export class PlaybookController {
  constructor(private readonly playbookService: PlaybookService) {}

  /** GET /playbook/cards?companyId= — методичка целиком, видна и менеджеру. */
  @Get('cards')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  listActive(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.playbookService.listActive(companyId);
  }

  /** GET /playbook/progress?companyId= — счётчик «сколько карточек до первой версии». */
  @Get('progress')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  getProgress(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.playbookService.getProgress(companyId);
  }

  /** GET /playbook/export?companyId= — материал для сборки документа, только активные карточки. */
  @Get('export')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  getExport(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.playbookService.getExportData(companyId);
  }

  /** GET /playbook/candidates?companyId= — очередь решений, видна только тем, кто решает. */
  @Get('candidates')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  listCandidates(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.playbookService.listCandidates(companyId);
  }

  /** POST /playbook/candidates/:id/confirm — РОП подтверждает: карточка входит в методичку. */
  @Post('candidates/:id/confirm')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  confirm(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @Body() dto: ConfirmCandidateDto,
    @CurrentUser() user: User,
  ) {
    assertSameCompany(user, companyId);
    return this.playbookService.confirm(id, companyId, dto, user.id, user.fullName);
  }

  /** POST /playbook/candidates/:id/dismiss — РОП решил, что это не системная ошибка. */
  @Post('candidates/:id/dismiss')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  dismiss(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @Body() dto: DismissCardDto,
    @CurrentUser() user: User,
  ) {
    assertSameCompany(user, companyId);
    return this.playbookService.dismiss(id, companyId, dto, user.id);
  }

  /** POST /playbook/cards/:id/archive — правило больше не актуально, убрать из методички. */
  @Post('cards/:id/archive')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  archive(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @Body() dto: DismissCardDto,
    @CurrentUser() user: User,
  ) {
    assertSameCompany(user, companyId);
    return this.playbookService.dismiss(id, companyId, dto, user.id);
  }

  /** PATCH /playbook/cards/:id — правка правила/примеров уже опубликованной карточки. */
  @Patch('cards/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  update(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @Body() dto: UpdatePlaybookCardDto,
    @CurrentUser() user: User,
  ) {
    assertSameCompany(user, companyId);
    return this.playbookService.update(id, companyId, dto);
  }

  /** POST /playbook/cards — ручная карточка вне автоматической детекции. */
  @Post('cards')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  createManual(
    @Query('companyId') companyId: string,
    @Body() dto: CreateManualCardDto,
    @CurrentUser() user: User,
  ) {
    assertSameCompany(user, companyId);
    return this.playbookService.createManual(companyId, dto, user.id, user.fullName);
  }
}
