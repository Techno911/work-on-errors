import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invite, InviteStatus } from './entities/invite.entity';
import { CreateInviteDto } from './dto/create-invite.dto';
import { UsersService } from '../users/users.service';
import { randomBytes } from 'crypto';

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(Invite)
    private readonly inviteRepository: Repository<Invite>,
    private readonly usersService: UsersService,
  ) {}

  async create(dto: CreateInviteDto, invitedById: string): Promise<Invite> {
    const code = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const invite = this.inviteRepository.create({
      ...dto,
      role: dto.role ?? 'manager',
      code,
      expiresAt,
      invitedById,
    });

    return this.inviteRepository.save(invite);
  }

  async findByCode(code: string): Promise<Invite> {
    // Без relations: accept() читает только invite.companyId/invite.role напрямую.
    // Полную Company/User для HTTP-ответа собирает findByCodePublic — узкой проекцией.
    const invite = await this.inviteRepository.findOne({ where: { code } });
    if (!invite) throw new NotFoundException('Приглашение не найдено');
    return invite;
  }

  // Неаутентифицированный эндпоинт (GET /invites/:code — приглашённый ещё не залогинен):
  // раньше relations:['company','invitedBy'] отдавали всю Company (offerToken, crmSetupToken,
  // telegramBindCode, legalInfo — реквизиты заказчика) кому угодно без входа в систему.
  async findByCodePublic(code: string): Promise<{
    email: string; fullName: string | null; role: string; status: InviteStatus;
    expiresAt: Date | null; company: { id: string; name: string } | null;
    invitedBy: { id: string; fullName: string } | null;
  }> {
    const invite = await this.inviteRepository.findOne({
      where: { code },
      relations: ['company', 'invitedBy'],
    });
    if (!invite) throw new NotFoundException('Приглашение не найдено');
    return {
      email: invite.email,
      fullName: invite.fullName ?? null,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
      company: invite.company ? { id: invite.company.id, name: invite.company.name } : null,
      invitedBy: invite.invitedBy
        ? { id: invite.invitedBy.id, fullName: invite.invitedBy.fullName }
        : null,
    };
  }

  async accept(code: string, userId: string): Promise<{ success: boolean }> {
    const invite = await this.findByCode(code);

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException('Приглашение уже использовано или истекло');
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      invite.status = InviteStatus.EXPIRED;
      await this.inviteRepository.save(invite);
      throw new BadRequestException('Срок действия приглашения истёк');
    }

    // Verify the accepting user's email matches the invite email
    const user = await this.usersService.findById(userId);
    if (user.email !== invite.email) {
      throw new BadRequestException('Это приглашение предназначено для другого адреса электронной почты');
    }

    // Update user: set companyId and role
    await this.usersService.updateCompanyAndRole(userId, invite.companyId, invite.role);

    invite.status = InviteStatus.ACCEPTED;
    await this.inviteRepository.save(invite);

    return { success: true };
  }

  async findByCompany(companyId: string): Promise<Invite[]> {
    return this.inviteRepository.find({
      where: { companyId },
      relations: ['invitedBy'],
      order: { createdAt: 'DESC' },
    });
  }
}
