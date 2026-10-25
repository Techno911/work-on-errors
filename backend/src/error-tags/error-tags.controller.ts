import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { ErrorTagsService } from './error-tags.service';
import { CreateErrorTagDto } from './dto/create-error-tag.dto';
import { UpdateErrorTagDto } from './dto/update-error-tag.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

@Controller('error-tags')
@UseGuards(JwtAuthGuard)
export class ErrorTagsController {
  constructor(private readonly errorTagsService: ErrorTagsService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  findAll(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== UserRole.SUPERADMIN && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    return this.errorTagsService.findAll(companyId);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageTags)
  create(@Body() dto: CreateErrorTagDto, @CurrentUser() user: User) {
    if (user.role !== UserRole.SUPERADMIN && user.companyId !== dto.companyId) {
      throw new ForbiddenException();
    }
    return this.errorTagsService.create(dto);
  }

  @Get(':id/usage')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadEntry)
  getUsage(@Param('id') id: string, @CurrentUser() user: User) {
    const scopeCompanyId = user.role === UserRole.SUPERADMIN ? undefined : (user.companyId ?? undefined);
    return this.errorTagsService.getUsage(id, scopeCompanyId);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageTags)
  update(@Param('id') id: string, @Body() dto: UpdateErrorTagDto, @CurrentUser() user: User) {
    return this.errorTagsService.update(id, dto, user.companyId ?? undefined);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ManageTags)
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.errorTagsService.remove(id, user.companyId ?? undefined);
  }
}
