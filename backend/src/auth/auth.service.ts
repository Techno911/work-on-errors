import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { Invite, InviteStatus } from '../invites/entities/invite.entity';
import { Company } from '../companies/entities/company.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { sendReportEmail } from '../analytics/mailer';
import { emailColor } from '../mail/design-tokens';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AuthResponse {
  accessToken: string;
  user: User;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(Invite)
    private readonly inviteRepository: Repository<Invite>,
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
  ) {}

  /**
   * Ежедневная очистка refresh_tokens (MEM1): таблица росла бесконечно — каждый логин/рефреш
   * пишет новую строку, ничего не удаляло старые. Токен, у которого expiresAt в прошлом, никогда
   * больше не пройдёт проверку (revoked он или нет) — 30-дневный запас нужен только на случай
   * разбора инцидента «когда у кого истекла сессия», дальше можно удалять безопасно.
   */
  @Cron('0 4 * * *', { name: 'refresh-tokens-cleanup' })
  async cleanupRefreshTokens(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await this.refreshTokenRepository.delete({ expiresAt: LessThan(cutoff) });
  }

  /**
   * AUDIT-0710 (H1): регистрация была открыта любому — POST /auth/register создавал
   * аккаунт manager без приглашения и компании. Теперь впуск только по живому
   * inviteCode (инвайт компании) или offerToken (оферта владельца); флаг
   * OPEN_REGISTRATION=false отключает саморегистрацию целиком.
   */
  private async assertRegistrationAllowed(dto: RegisterDto): Promise<void> {
    if (this.configService.get<string>('OPEN_REGISTRATION') === 'false') {
      throw new ForbiddenException('Регистрация закрыта: вход на платформу — по приглашению компании');
    }
    if (dto.inviteCode) {
      const invite = await this.inviteRepository.findOne({ where: { code: dto.inviteCode } });
      const usable =
        invite &&
        invite.status === InviteStatus.PENDING &&
        (!invite.expiresAt || invite.expiresAt > new Date()) &&
        invite.email.toLowerCase() === dto.email.toLowerCase();
      if (usable) return;
    }
    if (dto.offerToken) {
      const company = await this.companyRepository.findOne({ where: { offerToken: dto.offerToken } });
      if (company) return;
    }
    throw new ForbiddenException('Регистрация возможна только по приглашению компании или по ссылке оферты');
  }

  async register(dto: RegisterDto): Promise<AuthResponse & { refreshToken: string }> {
    await this.assertRegistrationAllowed(dto);
    const user = await this.usersService.create({
      email: dto.email.toLowerCase().trim(),
      password: dto.password,
      fullName: dto.fullName,
    });
    // Регистрация = первый реальный вход (человек сам задал пароль).
    await this.usersService.markLogin(user.id).catch(() => {});

    const tokens = await this.generateTokenPair(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
    };
  }

  async login(dto: LoginDto): Promise<AuthResponse & { refreshToken: string }> {
    // Normalize email to lowercase to handle case-insensitive login
    const user = await this.usersService.findByEmail(dto.email.toLowerCase().trim());
    if (!user) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Аккаунт деактивирован. Обратитесь к администратору.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    // Факт реального входа по паролю (бейдж «ещё не входил», логика запуска).
    // «Глазами» сюда не попадает: impersonate() не проходит через login().
    await this.usersService.markLogin(user.id).catch(() => {});

    const tokens = await this.generateTokenPair(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
    };
  }

  // Отдельный секрет для reset-токена: такой токен нельзя использовать как access/refresh.
  private resetSecret(): string {
    return (this.configService.getOrThrow<string>('JWT_SECRET')) + '_pwreset';
  }

  // SEC-6: отпечаток ТЕКУЩЕГО хеша пароля в claim — после первой успешной смены пароля хеш
  // меняется (bcrypt даёт новую соль даже для того же пароля), отпечаток перестаёт совпадать,
  // и токен из письма перестаёт проходить verify. Без доп. таблицы «использованных токенов».
  private pwdFingerprint(passwordHash: string): string {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
  }

  /** Запрос восстановления: всегда «успех» (не раскрываем существование аккаунта), письмо только реальному активному пользователю. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email.toLowerCase().trim());
    if (!user || !user.isActive) return;
    const token = await this.jwtService.signAsync(
      { sub: user.id, purpose: 'pwreset', pwh: this.pwdFingerprint(user.password) },
      { secret: this.resetSecret(), expiresIn: '3h' },
    );
    const appUrl = process.env.APP_URL || 'https://app.example.invalid';
    const link = `${appUrl}/reset-password/${encodeURIComponent(token)}`;
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:15px;color:${emailColor('color-fg')};line-height:1.6">
        <p>Здравствуйте, ${user.fullName}!</p>
        <p>Вы запросили восстановление пароля в платформе «Работа над ошибками».</p>
        <p><a href="${link}" style="display:inline-block;background:${emailColor('color-accent')};color:${emailColor('color-on-inverse')};text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Задать новый пароль</a></p>
        <p style="color:${emailColor('color-fg-subtle')};font-size:13px">Ссылка действует 3 часа. Если вы не запрашивали восстановление, просто проигнорируйте письмо: пароль не изменится.</p>
      </div>`;
    await sendReportEmail([user.email], 'Восстановление пароля в «Работе над ошибками»', html);
  }

  /** Сброс пароля по токену из письма. Одноразовый (SEC-6): второе применение — уже отклонено. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    let payload: { sub: string; purpose?: string; pwh?: string };
    try {
      payload = await this.jwtService.verifyAsync(token, { secret: this.resetSecret() });
    } catch {
      throw new UnauthorizedException('Ссылка недействительна или устарела. Запросите восстановление заново.');
    }
    if (payload.purpose !== 'pwreset') {
      throw new UnauthorizedException('Некорректная ссылка восстановления');
    }
    const user = await this.usersService.findById(payload.sub);
    if (!payload.pwh || payload.pwh !== this.pwdFingerprint(user.password)) {
      throw new UnauthorizedException('Ссылка уже использована. Запросите восстановление заново.');
    }
    await this.usersService.setPassword(payload.sub, newPassword);
    // Смена пароля обрывает все прежние сессии: украденный refresh-токен не переживает сброс.
    await this.refreshTokenRepository.update(
      { userId: payload.sub, isRevoked: false },
      { isRevoked: true },
    );
  }

  /**
   * Именная одноразовая ссылка первого входа: кто за ней стоит и жива ли она.
   *
   * Публичный эндпоинт, поэтому наружу отдаём минимум: имя и почту человека, которому ссылка
   * выдана, и название компании. Токен случайный (24 байта), сроком трое суток и гаснет после
   * применения — по чужой ссылке войти нельзя, а подобрать её нельзя за разумное время.
   */
  async describeActivation(token: string): Promise<{ fullName: string; email: string; companyName: string | null }> {
    const user = await this.usersService.findByActivationToken(token);
    if (!user) {
      throw new UnauthorizedException('Ссылка недействительна или уже использована. Попросите выслать новую.');
    }
    if (!user.activationTokenExpiresAt || user.activationTokenExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Срок ссылки истёк. Попросите выслать новую.');
    }
    return {
      fullName: user.fullName,
      email: user.email,
      companyName: user.company?.name ?? null,
    };
  }

  /**
   * Человек задаёт себе пароль по именной ссылке и сразу входит: отдельного экрана логина
   * после этого нет — лишний шаг на первом касании теряет людей ровно там, где мы их ждём.
   */
  async activate(token: string, password: string): Promise<AuthResponse & { refreshToken: string }> {
    const user = await this.usersService.findByActivationToken(token);
    if (!user) {
      throw new UnauthorizedException('Ссылка недействительна или уже использована. Попросите выслать новую.');
    }
    if (!user.activationTokenExpiresAt || user.activationTokenExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Срок ссылки истёк. Попросите выслать новую.');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Аккаунт деактивирован. Обратитесь к администратору.');
    }

    await this.usersService.setPassword(user.id, password);
    await this.usersService.consumeActivationToken(user.id);
    // Первый вход отмечаем тем же путём, что и обычный логин: от него считают сторожа.
    await this.usersService.markLogin(user.id).catch(() => {});

    const fresh = await this.usersService.findById(user.id);
    const tokens = await this.generateTokenPair(fresh);
    await this.saveRefreshToken(fresh.id, tokens.refreshToken);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: fresh };
  }

  async refreshTokens(
    userId: string,
    refreshToken: string,
  ): Promise<AuthResponse & { refreshToken: string }> {
    const isValid = await this.validateRefreshToken(userId, refreshToken);
    if (!isValid) {
      throw new ForbiddenException('Недействительный токен обновления');
    }

    const user = await this.usersService.findById(userId);
    if (!user || !user.isActive) {
      throw new ForbiddenException('Пользователь не найден или деактивирован');
    }

    // Revoke old refresh token
    await this.refreshTokenRepository.update(
      { token: refreshToken, userId },
      { isRevoked: true },
    );

    // Generate new pair
    const tokens = await this.generateTokenPair(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
    };
  }

  /**
   * Имперсонация суперадмином: короткоживущий access-токен сотрудника (15 минут)
   * БЕЗ refresh-токена и без cookie — сессия суперадмина в браузере не затрагивается,
   * F5 возвращает суперадмина. Доступ контролируется в AdminController.
   */
  async impersonate(userId: string): Promise<{ accessToken: string; user: User }> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.isActive) {
      throw new ForbiddenException('Пользователь не найден или деактивирован');
    }
    // Маркер имперсонации в access-токене: сервер различает «Глазами» и отклоняет
    // личные мутации (подтверждение чтения разбора). У имперсонации refresh нет,
    // токен живёт максимум 15 мин — немаркированные старые токены того же окна
    // это принятое ограничение перехода.
    const tokens = await this.generateTokenPair(user, { imp: true });
    return { accessToken: tokens.accessToken, user };
  }

  async logout(userId: string): Promise<void> {
    // Revoke all refresh tokens for this user
    await this.refreshTokenRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true },
    );
  }

  async getMe(userId: string): Promise<User> {
    return this.usersService.findById(userId);
  }

  private async generateTokenPair(user: User, extra?: Record<string, unknown>): Promise<TokenPair> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      ...extra,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION', '15m') as any,
      }),
      this.jwtService.signAsync(
        { sub: user.id },
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION', '7d') as any,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(
    userId: string,
    token: string,
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const refreshToken = this.refreshTokenRepository.create({
      token,
      userId,
      expiresAt,
    });

    await this.refreshTokenRepository.save(refreshToken);
  }

  private async validateRefreshToken(
    userId: string,
    token: string,
  ): Promise<boolean> {
    const refreshToken = await this.refreshTokenRepository.findOne({
      where: {
        token,
        userId,
        isRevoked: false,
      },
    });

    if (!refreshToken) {
      return false;
    }

    if (refreshToken.expiresAt < new Date()) {
      return false;
    }

    return true;
  }
}
