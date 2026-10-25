import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Sprint } from './entities/sprint.entity';
import { Entry } from '../entries/entities/entry.entity';
import { Company } from '../companies/entities/company.entity';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { SprintStatus } from './enums/sprint-status.enum';
import { Zone, calcZone } from '../common/zone.util';
import { weekBoundsFor, WeekBounds, rampUpWeek, scaleThreshold } from '../common/company-time.util';

@Injectable()
export class SprintsService {
  constructor(
    @InjectRepository(Sprint)
    private sprintsRepository: Repository<Sprint>,
    @InjectRepository(Entry)
    private entriesRepository: Repository<Entry>,
    @InjectRepository(Company)
    private companiesRepository: Repository<Company>,
  ) {}

  // Граница недели — по таймзоне компании (Камчатка UTC+12 живёт на 9 часов
  // впереди сервера; её понедельник должен открывать новый спринт вовремя)
  private async companyWeekBounds(companyId: string): Promise<WeekBounds> {
    const company = await this.companiesRepository.findOne({ where: { id: companyId } });
    return weekBoundsFor(company?.timezone);
  }

  async getOrCreateCurrent(companyId: string): Promise<Sprint> {
    const { startDate, endDate, monday, sunday } = await this.companyWeekBounds(companyId);

    let sprint = await this.sprintsRepository.findOne({
      where: { companyId, startDate, status: SprintStatus.ACTIVE },
    });

    if (!sprint) {
      // Auto-complete sprints whose endDate is before this week's start
      await this.sprintsRepository.update(
        { companyId, status: SprintStatus.ACTIVE, endDate: LessThan(startDate) },
        { status: SprintStatus.COMPLETED },
      );

      const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
      // Cross-month week: "30 мар–5 апр 2025", same month: "24–30 мар 2025"
      const label = monday.m === sunday.m
        ? `${monday.d}–${sunday.d} ${months[monday.m - 1]} ${monday.y}`
        : `${monday.d} ${months[monday.m - 1]}–${sunday.d} ${months[sunday.m - 1]} ${monday.y}`;
      try {
        sprint = await this.sprintsRepository.save(
          this.sprintsRepository.create({ companyId, startDate, endDate, label, status: SprintStatus.ACTIVE }),
        );
        await this.closeOtherActives(companyId, sprint.id);
      } catch (err) {
        // DI5: гонка двух одновременных запросов — второй ловит уникальный констрейнт
        // (companyId, startDate) и просто забирает спринт, который создал первый.
        if ((err as { code?: string }).code === '23505') {
          const existing = await this.sprintsRepository.findOne({ where: { companyId, startDate } });
          if (existing) return existing;
        }
        throw err;
      }
    }

    return sprint;
  }

  async getHistory(
    companyId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ sprints: Sprint[]; total: number; hasMore: boolean }> {
    const [sprints, total] = await this.sprintsRepository.findAndCount({
      where: { companyId },
      order: { startDate: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { sprints, total, hasMore: page * limit < total };
  }

  async findAll(companyId: string): Promise<Sprint[]> {
    return this.sprintsRepository.find({
      where: { companyId },
      order: { startDate: 'DESC' },
    });
  }

  async findById(id: string, companyId?: string): Promise<Sprint> {
    const sprint = await this.sprintsRepository.findOne({
      where: { id },
      relations: ['entries', 'entries.manager', 'entries.errorTags', 'entries.screenshots'],
    });
    if (!sprint) throw new NotFoundException('Спринт не найден');
    if (companyId && sprint.companyId !== companyId) {
      throw new ForbiddenException();
    }
    return sprint;
  }

  /**
   * AUDIT-0710 (L4/DI5): у компании не бывает двух активных спринтов — ручное создание
   * раньше оставляло прежние висеть активными, и дашборды смешивали недели.
   * Завершаем остальные активные в той же транзакции, что и сохранение нового.
   */
  private async closeOtherActives(companyId: string, excludeId: string): Promise<void> {
    await this.sprintsRepository
      .createQueryBuilder()
      .update()
      .set({ status: SprintStatus.COMPLETED })
      .where('"companyId" = :companyId', { companyId })
      .andWhere('status = :st', { st: SprintStatus.ACTIVE })
      .andWhere('id != :excludeId', { excludeId })
      .execute();
  }

  async create(dto: CreateSprintDto): Promise<Sprint> {
    const months = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const label = dto.label || `${start.getDate()}–${end.getDate()} ${months[start.getMonth()]} ${start.getFullYear()}`;
    const sprint = await this.sprintsRepository.save(
      this.sprintsRepository.create({ ...dto, label }),
    );
    if (sprint.status === SprintStatus.ACTIVE) {
      await this.closeOtherActives(dto.companyId, sprint.id);
    }
    return sprint;
  }

  // DI10: единственный осмысленный ручной переход — завершить активный спринт досрочно.
  // Раньше DTO принимал любое значение enum без проверки — можно было «реанимировать»
  // завершённый спринт обратно в active (второй одновременно активный спринт компании).
  private static readonly ALLOWED_TRANSITIONS: Partial<Record<SprintStatus, SprintStatus[]>> = {
    [SprintStatus.ACTIVE]: [SprintStatus.COMPLETED],
  };

  async update(id: string, dto: UpdateSprintDto, companyId?: string): Promise<Sprint> {
    const sprint = await this.findById(id, companyId);
    if (dto.status && dto.status !== sprint.status) {
      const allowed = SprintsService.ALLOWED_TRANSITIONS[sprint.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Переход спринта из «${sprint.status}» в «${dto.status}» недопустим`);
      }
    }
    Object.assign(sprint, dto);
    return this.sprintsRepository.save(sprint);
  }

  async getProgress(sprintId: string, managerId: string, companyId?: string) {
    const sprint = await this.sprintsRepository.findOne({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundException('Спринт не найден');
    if (companyId && sprint.companyId !== companyId) throw new ForbiddenException();

    const company = await this.companiesRepository.findOne({ where: { id: sprint.companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const entries = await this.entriesRepository.find({ where: { sprintId, managerId } });
    const callCount = entries.filter((e) => e.type === 'call').length;
    const chatCount = entries.filter((e) => e.type === 'chat').length;

    // Разгонная неделя (запуск не с понедельника): пороги урезаны пропорционально коротким дням.
    const { isRampUp, factor } = rampUpWeek(company, new Date(`${sprint.startDate}T12:00:00Z`));
    const thresholdGoodCalls = scaleThreshold(company.thresholdGoodCalls ?? 5, factor);
    const thresholdGoodChats = scaleThreshold(company.thresholdGoodChats ?? 5, factor);
    const thresholdGreatCalls = scaleThreshold(company.thresholdGreatCalls ?? 8, factor);
    const thresholdGreatChats = scaleThreshold(company.thresholdGreatChats ?? 8, factor);

    const callZone = company.callsEnabled ? calcZone(callCount, thresholdGoodCalls, thresholdGreatCalls) : null;
    const chatZone = company.chatsEnabled ? calcZone(chatCount, thresholdGoodChats, thresholdGreatChats) : null;

    const zones = [callZone, chatZone].filter((z): z is Zone => z !== null);
    const overallZone: Zone = zones.includes('below') ? 'below' : zones.includes('good') ? 'good' : 'great';

    return {
      managerId,
      calls: company.callsEnabled
        ? { count: callCount, thresholdGood: thresholdGoodCalls, thresholdGreat: thresholdGreatCalls, zone: callZone }
        : null,
      chats: company.chatsEnabled
        ? { count: chatCount, thresholdGood: thresholdGoodChats, thresholdGreat: thresholdGreatChats, zone: chatZone }
        : null,
      selfReviewCompleted: entries.filter((e) => e.selfReviewCorrect).length,
      reviewedByRop: entries.filter((e) => e.status === 'reviewed').length,
      overallZone,
      isRampUp,
      rampUpFactor: factor,
    };
  }

  async getTeamProgress(sprintId: string, companyId?: string) {
    const sprint = await this.sprintsRepository.findOne({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundException('Спринт не найден');
    if (companyId && sprint.companyId !== companyId) throw new ForbiddenException();

    const company = await this.companiesRepository.findOne({ where: { id: sprint.companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const entries = await this.entriesRepository.find({
      where: { sprintId },
      relations: ['manager'],
    });

    const managerMap = new Map<string, { manager: Entry['manager']; entries: Entry[] }>();
    for (const entry of entries) {
      if (!managerMap.has(entry.managerId)) {
        managerMap.set(entry.managerId, { manager: entry.manager, entries: [] });
      }
      managerMap.get(entry.managerId)!.entries.push(entry);
    }

    // Разгонная неделя (запуск не с понедельника): пороги команды урезаны так же, как у менеджера.
    const { isRampUp, factor } = rampUpWeek(company, new Date(`${sprint.startDate}T12:00:00Z`));
    const goodCalls = scaleThreshold(company.thresholdGoodCalls, factor);
    const goodChats = scaleThreshold(company.thresholdGoodChats, factor);
    const greatCalls = scaleThreshold(company.thresholdGreatCalls, factor);
    const greatChats = scaleThreshold(company.thresholdGreatChats, factor);

    const teamMembers = Array.from(managerMap.entries())
      .sort((a, b) => (a[1].manager?.fullName ?? '').localeCompare(b[1].manager?.fullName ?? ''))
      .map(([managerId, { manager, entries: mEntries }]) => {
        const callCount = mEntries.filter((e) => e.type === 'call' && (e.status === 'submitted' || e.status === 'reviewed')).length;
        const chatCount = mEntries.filter((e) => e.type === 'chat' && (e.status === 'submitted' || e.status === 'reviewed')).length;
        // Respect callsEnabled / chatsEnabled company settings
        const callZone = company.callsEnabled ? calcZone(callCount, goodCalls, greatCalls) : null;
        const chatZone = company.chatsEnabled ? calcZone(chatCount, goodChats, greatChats) : null;
        const zones = [callZone, chatZone].filter((z): z is Zone => z !== null);
        const zone: Zone = zones.length === 0 ? 'good' : zones.includes('below') ? 'below' : zones.includes('good') ? 'good' : 'great';

        const lastEntry = [...mEntries].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )[0];

        return {
          id: managerId,
          fullName: manager?.fullName ?? 'Менеджер',
          color: manager?.color ?? null,
          entriesCount: mEntries.length,
          zone,
          submittedAt: lastEntry?.updatedAt ?? null,
        };
      });

    return { teamMembers, isRampUp, rampUpFactor: factor };
  }
}
