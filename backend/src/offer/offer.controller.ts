import { Controller, Get, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import type { Request } from 'express';
import { OfferService } from './offer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

class AcceptOfferDto {
  @IsBoolean()
  pdnConsent!: boolean;
}

@Controller('offer')
export class OfferController {
  constructor(private readonly offerService: OfferService) {}

  /** Публично: витрина оферты по токену (страница /offer/:token до логина). */
  @Get(':token')
  getPublicInfo(@Param('token') token: string) {
    return this.offerService.getPublicInfo(token);
  }

  /** Принятие оферты: текущий пользователь становится владельцем, стартует триал.
   * pdnConsent — отдельный обязательный флаг согласия на ПДн (ст. 9 152-ФЗ, не подразумевается акцептом оферты). */
  @Post(':token/accept')
  @UseGuards(JwtAuthGuard)
  accept(@Param('token') token: string, @Body() dto: AcceptOfferDto, @CurrentUser() user: User, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
    return this.offerService.accept(token, user.id, { pdnConsent: dto.pdnConsent, ip });
  }
}
