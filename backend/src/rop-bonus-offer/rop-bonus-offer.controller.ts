import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { RopBonusOfferService } from './rop-bonus-offer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { RopBonusSetup } from '../companies/entities/company.entity';

@Controller('rop-bonus-offer')
export class RopBonusOfferController {
  constructor(private readonly svc: RopBonusOfferService) {}

  // ── Владелец в мастере онбординга (по своей companyId, без токена). Роуты 'self/*'
  //    объявлены ДО ':token', иначе 'self' спарсится как токен. ──
  @Get('self')
  @UseGuards(JwtAuthGuard)
  getSelf(@CurrentUser() user: User) {
    return this.svc.getSelfRecommendation(user);
  }

  @Post('self/accept')
  @UseGuards(JwtAuthGuard)
  acceptSelf(@CurrentUser() user: User) {
    return this.svc.acceptSelf(user);
  }

  @Post('self/discuss')
  @UseGuards(JwtAuthGuard)
  discussSelf(@CurrentUser() user: User) {
    return this.svc.discussSelf(user);
  }

  /** Премия не нужна — осознанный отказ собственника прямо на главной, без трекера. */
  @Post('self/decline')
  @UseGuards(JwtAuthGuard)
  declineSelf(@CurrentUser() user: User) {
    return this.svc.declineSelf(user);
  }

  /** Публично: витрина предложения по токену (лендинг /rop-bonus-offer/:token). */
  @Get(':token')
  getPublicInfo(@Param('token') token: string) {
    return this.svc.getPublicInfo(token);
  }

  /** Принять рекомендованное — только под входом собственника этой компании. */
  @Post(':token/accept')
  @UseGuards(JwtAuthGuard)
  accept(@Param('token') token: string, @CurrentUser() user: User) {
    return this.svc.accept(token, user);
  }

  /** Настроить иначе — вариант уходит трекеру на согласование, в прод не пишется. */
  @Post(':token/customize')
  @UseGuards(JwtAuthGuard)
  customize(@Param('token') token: string, @Body() body: Partial<RopBonusSetup>, @CurrentUser() user: User) {
    return this.svc.customize(token, user, body);
  }

  /** Пока не вводим — осознанный отказ собственника. */
  @Post(':token/decline')
  @UseGuards(JwtAuthGuard)
  decline(@Param('token') token: string, @CurrentUser() user: User) {
    return this.svc.decline(token, user);
  }
}
