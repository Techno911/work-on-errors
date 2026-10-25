import {BadRequestException, Injectable,
  Logger,
  NotFoundException,
  ConflictException, } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import { join } from 'path';
import { User } from './entities/user.entity';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UserRole } from './enums/user-role.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly events: CompanyEventsService,
  ) {}

  // company как relation тянул ВСЮ Company-сущность (offerToken, telegramBindCode,
  // ropBonus.baseAmount, ropBonusProposal.token, legalInfo/ИНН, reportChannels) в любой
  // ответ, содержащий пользователя (/auth/me, GET/PATCH /users/:id) — видно всем ролям,
  // вплоть до менеджера (LEAK1/E2). Фронт объявляет company как {id,name} (frontend/src/types/index.ts)
  // и больше нигде её поля не читает — приводим бэкенд к тому же контракту явным select,
  // а не relations:['company'] + @Exclude постфактум (лишние поля физически не попадают в память).
  private userQuery() {
    return this.usersRepository
      .createQueryBuilder('user')
      .leftJoin('user.company', 'company')
      // paymentHold читает глобальный PaymentHoldGuard на каждом запросе: держим его здесь,
      // чтобы замок не делал отдельный поход в базу. Сумму и причину задолженности не берём:
      // они уходят только собственнику отдельным эндпоинтом.
      .addSelect(['company.id', 'company.name', 'company.paymentHold']);
  }

  async findAll(companyId?: string): Promise<User[]> {
    const qb = this.userQuery().orderBy('user.createdAt', 'ASC');
    if (companyId) qb.andWhere('user.companyId = :companyId', { companyId });
    return qb.getMany();
  }

  async findById(id: string): Promise<User> {
    const user = await this.userQuery().where('user.id = :id', { id }).getOne();
    if (!user) {
      throw new NotFoundException(`Пользователь с id ${id} не найден`);
    }
    return user;
  }

  /**
   * Отметка реального входа (login/register).
   *
   * Первый вход человека это событие, которого платформа раньше не замечала вовсе: доступ
   * выданный, доступ доставленный и вход это три разных события, а склеены они были в одно
   * (разбор жизненного цикла, часть 1). Теперь первый вход попадает в журнал компании и
   * закрывает ожидание, которое поставил сторож выданных доступов.
   */
  async markLogin(id: string): Promise<void> {
    const before = await this.usersRepository.findOne({ where: { id }, select: ['id', 'companyId', 'fullName', 'role', 'lastLoginAt'] });
    await this.usersRepository.update({ id }, { lastLoginAt: new Date() });
    if (before && before.companyId && !before.lastLoginAt) {
      await this.events.log({
        companyId: before.companyId,
        type: CompanyEventType.FIRST_LOGIN,
        title: `Первый вход: ${before.fullName}`,
        details: 'Человек вошёл на платформу впервые. Подключение считается закрытым только после первой сданной записи.',
        actorUserId: before.id,
        actorLabel: before.fullName,
        payload: { userId: before.id, role: before.role },
      });
    }
  }

  /** Пользователь по именной ссылке первого входа (вместе с компанией: её имя видит человек). */
  async findByActivationToken(token: string): Promise<User | null> {
    if (!token || token.length < 16) return null;
    return this.userQuery().where('user.activationToken = :token', { token }).getOne();
  }

  /**
   * Гасим ссылку после применения: одноразовость это половина её безопасности, вторая
   * половина — короткий срок жизни.
   */
  async consumeActivationToken(userId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) return;
    user.activationToken = null;
    user.activationTokenExpiresAt = null;
    await this.usersRepository.save(user);
    if (user.companyId) {
      await this.events.log({
        companyId: user.companyId,
        type: CompanyEventType.ACCESS_ACTIVATED,
        title: `Доступ активирован: ${user.fullName}`,
        details: 'Человек задал себе пароль по именной ссылке. Ссылка погашена.',
        actorUserId: user.id,
        actorLabel: user.fullName,
        payload: { userId: user.id },
      });
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userQuery().where('user.email = :email', { email }).getOne();
  }

  /** Поиск по email, ВКЛЮЧАЯ soft-deleted строки: uniq-констрейнт на email удерживает их, и без
   *  этого повторный invite/create ранее удалённого сотрудника падал 500 (INSERT → 23505). */
  private async findByEmailIncludingDeleted(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.email = :email', { email })
      .getOne();
  }

  async create(dto: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const existing = await this.findByEmailIncludingDeleted(dto.email);
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Пользователь с email ${dto.email} уже зарегистрирован`);
    }
    if (existing && existing.deletedAt) {
      // Возврат ранее удалённого сотрудника: восстанавливаем его строку (она держит email), а не INSERT
      Object.assign(existing, dto, { password: hashedPassword, isActive: true });
      existing.deletedAt = null;
      return this.usersRepository.save(existing);
    }

    const user = this.usersRepository.create({
      ...dto,
      password: hashedPassword,
    });

    return this.usersRepository.save(user);
  }

  /** Смена собственного пароля: проверяем текущий, сохраняем новый (bcryptjs). */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Пользователь не найден');
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) throw new BadRequestException('Текущий пароль указан неверно');
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Новый пароль должен быть не короче 6 символов');
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.save(user);
  }

  /** Установить новый пароль без проверки текущего — для восстановления по email-токену. */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Пароль должен быть не короче 6 символов');
    }
    const user = await this.findById(userId);
    user.password = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.save(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    // Скрытие первых шагов живёт в контексте «роль в компании»: при ФАКТИЧЕСКОЙ смене
    // role или companyId выбор прошлого контекста сбрасывается, иначе менеджер перенёс бы
    // своё «скрыть» в роль РОПа, где обучение другое. Передача прежнего значения или правка
    // другого поля выбор не трогают.
    // companyId в UpdateUserDto сейчас нет (ValidationPipe отсекает лишнее), но проверка
    // держится типобезопасной, чтобы при расширении DTO сброс не потерялся.
    const dtoCompanyId = (dto as UpdateUserDto & { companyId?: string | null }).companyId;
    if (
      (dto.role !== undefined && dto.role !== user.role) ||
      (dtoCompanyId !== undefined && dtoCompanyId !== user.companyId)
    ) {
      user.firstStepsHiddenAt = null;
    }

    Object.assign(user, dto);

    return this.usersRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.usersRepository.softRemove(user);
  }

  async hardDelete(id: string): Promise<void> {
    const user = await this.findById(id);

    // Очистка всех FK-зависимостей, затем удаление — в одной транзакции
    await this.dataSource.transaction(async (em) => {
      // Entries: обнулить managerId/reviewerId (FK NO ACTION → блокирует DELETE)
      await em.query(`UPDATE entries SET "managerId" = NULL WHERE "managerId" = $1`, [id]);
      await em.query(`UPDATE entries SET "reviewerId" = NULL WHERE "reviewerId" = $1`, [id]);
      // Gamification (FK NO ACTION → блокирует DELETE)
      await em.query(`DELETE FROM user_gamification WHERE "userId" = $1`, [id]);
      await em.query(`DELETE FROM achievements WHERE "userId" = $1`, [id]);
      await em.query(`DELETE FROM xp_transactions WHERE "userId" = $1`, [id]);
      // Эти CASCADE, но чистим явно для надёжности
      await em.query(`DELETE FROM refresh_tokens WHERE "user_id" = $1`, [id]);
      await em.query(`DELETE FROM notifications WHERE "userId" = $1`, [id]);
      // Удаление пользователя
      await em.query(`DELETE FROM users WHERE id = $1`, [id]);
    });

    this.logger.log(`Hard deleted user ${user.email} (id: ${id})`);
  }

  async invite(dto: InviteUserDto): Promise<User> {
    const existing = await this.findByEmailIncludingDeleted(dto.email);
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Пользователь с email ${dto.email} уже зарегистрирован`);
    }

    // Криптостойкий временный пароль (не Math.random — предсказуем и брутфорсится).
    const tempPassword = randomBytes(12).toString('base64url');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    if (existing && existing.deletedAt) {
      // Возврат ранее удалённого сотрудника: восстанавливаем строку (она держит email) вместо INSERT
      existing.fullName = dto.fullName;
      existing.role = dto.role;
      existing.companyId = dto.companyId;
      existing.password = hashedPassword;
      existing.isActive = true;
      existing.deletedAt = null;
      const restored = await this.usersRepository.save(existing);
      this.logger.log(`Re-invited (restored) user ${dto.email}`);
      return restored;
    }

    const user = this.usersRepository.create({
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      companyId: dto.companyId,
      password: hashedPassword,
    });

    const savedUser = await this.usersRepository.save(user);

    // In future: send invitation email with tempPassword
    this.logger.log(`Invited user ${dto.email} (temp password set)`);

    return savedUser;
  }

  async uploadAvatar(id: string, filename: string): Promise<User> {
    const user = await this.findById(id);
    // Удаляем старый аватар если был
    if (user.avatarUrl) {
      const oldFilename = user.avatarUrl.split('/').pop();
      if (oldFilename) {
        const oldPath = join(process.cwd(), 'uploads', 'avatars', oldFilename);
        try { fs.unlinkSync(oldPath); } catch { /* файл уже удалён */ }
      }
    }
    user.avatarUrl = `/uploads/avatars/${filename}`;
    return this.usersRepository.save(user);
  }

  async updateCompanyAndRole(userId: string, companyId: string, role: string): Promise<void> {
    // Принятие приглашения/оферты всегда меняет контекст: скрытие первых шагов сбрасываем.
    await this.usersRepository.update(userId, { companyId, role: role as UserRole, firstStepsHiddenAt: null });
  }

  /**
   * Личное скрытие/возврат учебной карточки «Первые шаги». Пишется только про СЕБЯ
   * (контроллер берёт id из токена), поле в UpdateUserDto не заведено — иначе чужую
   * отметку можно было бы сбросить через PATCH /users/:id. Идемпотентно.
   */
  async setFirstStepsHidden(userId: string, hidden: boolean): Promise<User> {
    const user = await this.findById(userId);
    user.firstStepsHiddenAt = hidden ? new Date() : null;
    return this.usersRepository.save(user);
  }

  /**
   * Отметка «анонс этой версии прочитан». Пишется только про СЕБЯ (контроллер берёт id из токена),
   * поэтому поле сознательно не заведено в UpdateUserDto: иначе чужую отметку можно было бы
   * сбросить через PATCH /users/:id.
   */
  async markReleasesSeen(userId: string, version: string): Promise<{ version: string }> {
    await this.usersRepository.update(userId, { releasesSeenVersion: version });
    return { version };
  }

  /** Личное согласие на ПДн + ознакомление с ЛНА — оба штампа одним моментом, но раздельные поля. */
  async recordPdnConsent(userId: string, ip: string | null): Promise<{ recorded: boolean }> {
    const now = new Date();
    await this.usersRepository.update(userId, {
      pdnConsentAcceptedAt: now,
      lnaAcknowledgedAt: now,
      pdnConsentIp: ip,
    });
    return { recorded: true };
  }
}
