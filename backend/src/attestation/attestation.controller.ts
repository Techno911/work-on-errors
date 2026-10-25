import { Controller, Get, Post, Put, Param, Query, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { AttestationService } from './attestation.service';
import { GenerateTestDto, AssignTestDto, SaveAnswerDto, GradeAnswerDto } from './dto/attestation.dto';
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

@Controller('attestation')
@UseGuards(JwtAuthGuard)
export class AttestationController {
  constructor(private readonly service: AttestationService) {}

  // ───────────────────────── РОП ─────────────────────────

  @Get('tests')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  listTests(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.service.listTests(companyId);
  }

  @Post('tests')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  generateTest(@Query('companyId') companyId: string, @Body() dto: GenerateTestDto, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.service.generateTest(companyId, dto, user.id);
  }

  @Post('tests/:id/assign')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  assign(@Param('id') id: string, @Query('companyId') companyId: string, @Body() dto: AssignTestDto, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.service.assign(id, companyId, dto.deadline);
  }

  @Get('tests/:id/attempts')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  listAttempts(@Param('id') id: string, @Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.service.listAttempts(id, companyId);
  }

  @Get('attempts/:id/review')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  getForReview(@Param('id') id: string, @Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.service.getAttemptForReview(id, companyId);
  }

  @Put('attempts/:id/answers/:questionId/grade')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  gradeAnswer(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Query('companyId') companyId: string,
    @Body() dto: GradeAnswerDto,
    @CurrentUser() user: User,
  ) {
    assertSameCompany(user, companyId);
    return this.service.gradeAnswer(id, questionId, companyId, dto.reviewerScore);
  }

  @Post('attempts/:id/finalize')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  finalize(@Param('id') id: string, @Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.service.finalize(id, companyId, user.id);
  }

  @Post('attempts/:id/retake')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageMethodology)
  retake(@Param('id') id: string, @Query('companyId') companyId: string, @CurrentUser() user: User) {
    assertSameCompany(user, companyId);
    return this.service.createRetake(id, companyId, user.id);
  }

  // ───────────────────────── Менеджер ─────────────────────────

  @Get('my')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.TakeAttestation)
  listMy(@CurrentUser() user: User) {
    return this.service.listMyAttempts(user.id);
  }

  @Get('attempts/:id/take')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.TakeAttestation)
  getForTaking(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.getAttemptForTaking(id, user.id);
  }

  @Get('attempts/:id/result')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.TakeAttestation)
  getMyResult(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.getMyResult(id, user.id);
  }

  @Put('attempts/:id/answers/:questionId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.TakeAttestation)
  saveAnswer(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: SaveAnswerDto,
    @CurrentUser() user: User,
  ) {
    return this.service.saveAnswer(id, questionId, dto.answerText, user.id);
  }

  @Post('attempts/:id/submit')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.TakeAttestation)
  submit(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.submit(id, user.id);
  }
}
