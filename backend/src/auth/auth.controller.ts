import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { Throttle } from '@nestjs/throttler';

function getRefreshCookieOptions(rememberMe = false) {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth',
  };
  if (rememberMe) {
    return { ...base, maxAge: 30 * 24 * 60 * 60 * 1000 }; // 30 days
  }
  // Session cookie — удаляется при закрытии браузера
  return base;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(dto);

    response.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions(false));

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  // Запрос восстановления пароля. Всегда 200, даже если email не найден (не раскрываем аккаунты).
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { ok: true };
  }

  // Установка нового пароля по токену из письма.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  // Кто стоит за именной ссылкой первого входа (публично, по самому токену).
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('activation/:token')
  async describeActivation(@Param('token') token: string) {
    return this.authService.describeActivation(token);
  }

  // Человек задаёт пароль по именной ссылке и сразу входит.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('activation/:token')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Param('token') token: string,
    @Body() dto: { password?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.activate(token, dto?.password ?? '');
    response.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions(true));
    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);

    response.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions(dto.rememberMe));

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { userId, refreshToken } = req.user as {
      userId: string;
      refreshToken: string;
    };
    const result = await this.authService.refreshTokens(userId, refreshToken);

    // Refresh сохраняет тип сессии — если пользователь уже залогинен, cookie уже существует
    response.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions(true));

    return {
      accessToken: result.accessToken,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(user.id);

    response.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/api/auth',
    });

    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: User) {
    return { user };
  }
}
