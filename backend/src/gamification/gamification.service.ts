import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { UserGamification } from './entities/user-gamification.entity';
import { Achievement } from './entities/achievement.entity';
import { XpTransaction } from './entities/xp-transaction.entity';
import { AchievementType } from './enums/achievement-type.enum';
import { XpReason } from './enums/xp-reason.enum';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import {
  XpSettingsData,
  AchievementSettingsData,
  DEFAULT_XP_SETTINGS,
  DEFAULT_ACHIEVEMENT_SETTINGS,
} from './types/gamification-settings.types';

export function getLevel(xp: number): { level: number; title: string; emoji: string; nextXp: number | null } {
  if (xp >= 5500) return { level: 7, title: 'Эталон', emoji: '🌟', nextXp: null };
  if (xp >= 3500) return { level: 6, title: 'Наставник', emoji: '🎓', nextXp: 5500 };
  if (xp >= 2000) return { level: 5, title: 'Мастер', emoji: '🏆', nextXp: 3500 };
  if (xp >= 1000) return { level: 4, title: 'Эксперт', emoji: '💎', nextXp: 2000 };
  if (xp >= 500)  return { level: 3, title: 'Специалист', emoji: '🔥', nextXp: 1000 };
  if (xp >= 200)  return { level: 2, title: 'Практик', emoji: '⚡', nextXp: 500 };
  return { level: 1, title: 'Стажёр', emoji: '🌱', nextXp: 200 };
}

// UTC-методы намеренно, не локальные: раньше day/setDate/setHours были локальными, а итог
// уходил через toISOString() (UTC) — на проде это совпадает (контейнер в UTC), но на машине
// с другим TZ (замечено при написании теста GAM2/GAM8 на Europe/Moscow) местная «полночь
// понедельника» уезжает в UTC-воскресенье, и thisWeek получает дату на день раньше нужной.
// UTC-арифметика делает границу недели детерминированной независимо от TZ процесса.
export function getMondayStr(d = new Date()): string {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  mon.setUTCHours(0, 0, 0, 0);
  return mon.toISOString().split('T')[0];
}

const XP_REASON_KEY: Record<XpReason, keyof XpSettingsData> = {
  [XpReason.ENTRY_SUBMITTED]: 'entrySubmitted',
  [XpReason.SELF_REVIEW_COMPLETE]: 'selfReviewComplete',
  [XpReason.REVIEW_RECEIVED]: 'reviewReceived',
  [XpReason.REVIEW_NO_ERRORS]: 'reviewNoErrors',
  [XpReason.WEEKLY_GOOD_ZONE]: 'weeklyGoodZone',
  [XpReason.WEEKLY_GREAT_ZONE]: 'weeklyGreatZone',
  [XpReason.STREAK_BONUS]: 'streakBonus',
};

@Injectable()
export class GamificationService {
  constructor(
    @InjectRepository(UserGamification)
    private readonly gamRepo: Repository<UserGamification>,
    @InjectRepository(Achievement)
    private readonly achRepo: Repository<Achievement>,
    @InjectRepository(XpTransaction)
    private readonly txRepo: Repository<XpTransaction>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
  ) {}

  // ── Получить настройки компании по userId ─────────────────────
  private async getSettingsByUserId(userId: string): Promise<{ xp: XpSettingsData; ach: AchievementSettingsData }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.companyId) return { xp: DEFAULT_XP_SETTINGS, ach: DEFAULT_ACHIEVEMENT_SETTINGS };
    return this.getSettingsByCompanyId(user.companyId);
  }

  private async getSettingsByCompanyId(companyId: string): Promise<{ xp: XpSettingsData; ach: AchievementSettingsData }> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    return {
      xp: company?.xpSettings ?? DEFAULT_XP_SETTINGS,
      ach: company?.achievementSettings ?? DEFAULT_ACHIEVEMENT_SETTINGS,
    };
  }

  // ── Получить или создать запись геймификации ──────────────────
  async getOrCreate(userId: string): Promise<UserGamification> {
    let gam = await this.gamRepo.findOne({ where: { userId } });
    if (!gam) {
      gam = this.gamRepo.create({ userId, totalXp: 0, currentStreak: 0, bestStreak: 0 });
      gam = await this.gamRepo.save(gam);
    }
    return gam;
  }

  // ── Начислить XP ─────────────────────────────────────────────
  async awardXp(userId: string, reason: XpReason, entryId?: string, companyId?: string): Promise<void> {
    const settings = companyId
      ? await this.getSettingsByCompanyId(companyId)
      : await this.getSettingsByUserId(userId);

    const key = XP_REASON_KEY[reason];
    const amount = settings.xp[key];
    if (!amount) return;

    const gam = await this.getOrCreate(userId);
    gam.totalXp = Math.max(0, gam.totalXp + amount);
    await this.gamRepo.save(gam);

    await this.txRepo.save(
      this.txRepo.create({ userId, amount, reason, entryId: entryId ?? null })
    );
  }

  // ── Обновить стрик (вызывается при submit записи) ────────────
  async updateStreak(userId: string, companyId?: string): Promise<void> {
    const gam = await this.getOrCreate(userId);
    const thisWeek = getMondayStr();

    if (gam.lastStreakWeek === thisWeek) return; // уже засчитано на этой неделе

    // Проверяем: прошлая неделя = thisWeek - 7 дней; позапрошлая = thisWeek - 14 дней.
    // UTC-методы (см. getMondayStr) — thisWeek уже UTC-дата-строка, местные setDate/getDate
    // дали бы расхождение на процессах не в UTC.
    const lastWeekDate = new Date(thisWeek);
    lastWeekDate.setUTCDate(lastWeekDate.getUTCDate() - 7);
    const lastWeek = lastWeekDate.toISOString().split('T')[0];
    const twoWeeksAgoDate = new Date(thisWeek);
    twoWeeksAgoDate.setUTCDate(twoWeeksAgoDate.getUTCDate() - 14);
    const twoWeeksAgo = twoWeeksAgoDate.toISOString().split('T')[0];

    if (gam.lastStreakWeek === lastWeek) {
      gam.currentStreak += 1;
    } else if (gam.lastStreakWeek === twoWeeksAgo && gam.streakFreezes > 0) {
      // Заморозка спасает СЕРИЮ РОВНО НА ОДНУ пропущенную неделю (отпуск/больничный).
      // Раньше условие проверяло только «есть хоть одна заморозка», без сравнения
      // с реальным разрывом — молчание в 5+ недель бриджилось одной заморозкой,
      // серия «сама себя» восстанавливала, а бонусы %4/%8 капали из воздуха (GAM2/GAM8).
      gam.streakFreezes -= 1;
      gam.currentStreak += 1;
    } else {
      gam.currentStreak = 1; // серия сброшена (в т.ч. разрыв в 2+ недели даже при наличии заморозки)
    }

    if (gam.currentStreak > gam.bestStreak) {
      gam.bestStreak = gam.currentStreak;
    }
    gam.lastStreakWeek = thisWeek;
    await this.gamRepo.save(gam);

    // Бонус за каждые 4 недели серии
    if (gam.currentStreak % 4 === 0) {
      await this.awardXp(userId, XpReason.STREAK_BONUS, undefined, companyId);
    }
    // Каждые 8 недель серии — заморозка (запас не больше 2)
    if (gam.currentStreak % 8 === 0 && gam.streakFreezes < 2) {
      gam.streakFreezes += 1;
      await this.gamRepo.save(gam);
    }

    const { ach } = companyId
      ? await this.getSettingsByCompanyId(companyId)
      : await this.getSettingsByUserId(userId);

    // Проверка ачивок стрика
    if (gam.currentStreak >= ach.streak7Threshold) await this.grantAchievement(userId, AchievementType.STREAK_7);
    if (gam.currentStreak >= ach.streak30Threshold) await this.grantAchievement(userId, AchievementType.STREAK_30);
  }

  // ── Выдать ачивку (идемпотентно) ─────────────────────────────
  async grantAchievement(userId: string, type: AchievementType): Promise<boolean> {
    const exists = await this.achRepo.findOne({ where: { userId, type } });
    if (exists) return false;
    await this.achRepo.save(this.achRepo.create({ userId, type }));
    return true; // true = только что выдана (для уведомлений в будущем)
  }

  // ── Обработка submit записи ───────────────────────────────────
  async onEntrySubmitted(userId: string, entryId: string, isFirstSubmitEver: boolean, isFirstDayOfSprint: boolean, companyId?: string): Promise<void> {
    await this.awardXp(userId, XpReason.ENTRY_SUBMITTED, entryId, companyId);
    await this.updateStreak(userId, companyId);
    if (isFirstSubmitEver) await this.grantAchievement(userId, AchievementType.FIRST_SUBMIT);
  }

  // ── Обработка заполненного самоанализа ───────────────────────
  async onSelfReviewComplete(userId: string, entryId: string, companyId?: string): Promise<void> {
    await this.awardXp(userId, XpReason.SELF_REVIEW_COMPLETE, entryId, companyId);

    const gam = await this.getOrCreate(userId);
    gam.consecutiveFullSelfReviews += 1;
    await this.gamRepo.save(gam);

    const { ach } = companyId
      ? await this.getSettingsByCompanyId(companyId)
      : await this.getSettingsByUserId(userId);

    if (gam.consecutiveFullSelfReviews >= ach.writerThreshold) {
      await this.grantAchievement(userId, AchievementType.WRITER);
    }
  }

  // ── Обработка полученного ревью (для менеджера) ───────────────
  async onReviewReceived(managerId: string, entryId: string, hasErrorTags: boolean, companyId?: string): Promise<void> {
    await this.awardXp(managerId, XpReason.REVIEW_RECEIVED, entryId, companyId);

    const gam = await this.getOrCreate(managerId);
    if (!hasErrorTags) {
      await this.awardXp(managerId, XpReason.REVIEW_NO_ERRORS, entryId, companyId);
      gam.consecutiveNoErrorReviews += 1;
    } else {
      gam.consecutiveNoErrorReviews = 0;
    }
    await this.gamRepo.save(gam);

    const { ach } = companyId
      ? await this.getSettingsByCompanyId(companyId)
      : await this.getSettingsByUserId(managerId);

    // «Снайпер» за серию разборов без ошибок поощрял отбор «чистых» звонков —
    // выдача закрыта до перевода механики на «без повторения старых ошибок».
    void ach;
  }

  // ── Обработка недельных зон (вызывается вручную или cron) ─────
  async onWeeklyZone(userId: string, zone: 'good' | 'great', companyId?: string): Promise<void> {
    const reason = zone === 'great' ? XpReason.WEEKLY_GREAT_ZONE : XpReason.WEEKLY_GOOD_ZONE;
    await this.awardXp(userId, reason, undefined, companyId);

    if (zone === 'great') {
      const gam = await this.getOrCreate(userId);
      gam.consecutiveGreatWeeks += 1;
      await this.gamRepo.save(gam);

      const { ach } = companyId
        ? await this.getSettingsByCompanyId(companyId)
        : await this.getSettingsByUserId(userId);

      if (gam.consecutiveGreatWeeks >= ach.great3xThreshold) {
        await this.grantAchievement(userId, AchievementType.GREAT_3X);
      }
    }
  }

  // ── Недельная зона, идемпотентно по неделе [weekFrom, weekTo) ─────────
  // Раньше onWeeklyZone нигде не вызывался (GAM13) — XP/ачивка GREAT_3X не начислялись,
  // хотя зона считалась и показывалась менеджеру. Идемпотентность через проверку уже
  // существующей транзакции WEEKLY_*_ZONE в этом окне — безопасно от повторных вызовов
  // крона/ретраев, НЕ полагается на внешний флаг «уже начисляли».
  async awardWeeklyZoneOnce(userId: string, zone: 'good' | 'great', companyId: string, weekFrom: Date, weekTo: Date): Promise<void> {
    const already = await this.txRepo.count({
      where: [
        { userId, reason: XpReason.WEEKLY_GOOD_ZONE, createdAt: Between(weekFrom, weekTo) },
        { userId, reason: XpReason.WEEKLY_GREAT_ZONE, createdAt: Between(weekFrom, weekTo) },
      ],
    });
    if (already > 0) return;
    await this.onWeeklyZone(userId, zone, companyId);
  }

  // companyId пользователя — для проверки доступа к чужому профилю в контроллере
  async getUserCompanyId(userId: string): Promise<string | null> {
    const target = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'companyId'] });
    return target?.companyId ?? null;
  }

  // ── Профиль пользователя ──────────────────────────────────────
  async getProfile(userId: string) {
    const gam = await this.getOrCreate(userId);
    const achievements = await this.achRepo.find({ where: { userId }, order: { earnedAt: 'ASC' } });

    // XP за эту неделю
    const weekStart = new Date(getMondayStr());
    const weeklyXp = await this.txRepo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'sum')
      .where('tx.userId = :userId', { userId })
      .andWhere('tx.createdAt >= :weekStart', { weekStart })
      .getRawOne()
      .then(r => Number(r?.sum ?? 0));

    // История XP по неделям (последние 8)
    const history = await this.txRepo
      .createQueryBuilder('tx')
      .select("date_trunc('week', tx.createdAt)::date", 'week')
      .addSelect('SUM(tx.amount)', 'xp')
      .where('tx.userId = :userId', { userId })
      .andWhere("tx.createdAt >= NOW() - INTERVAL '56 days'")
      .groupBy("date_trunc('week', tx.createdAt)")
      .orderBy('week', 'ASC')
      .getRawMany();

    return {
      ...getLevel(gam.totalXp),
      totalXp: gam.totalXp,
      weeklyXp,
      currentStreak: gam.currentStreak,
      bestStreak: gam.bestStreak,
      achievements: achievements.map(a => ({ type: a.type, earnedAt: a.earnedAt })),
      xpHistory: history.map(h => ({ week: h.week, xp: Number(h.xp) })),
    };
  }

  // ── Лидерборд команды ─────────────────────────────────────────
  async getLeaderboard(companyId: string) {
    const users = await this.userRepo.find({
      where: { companyId, role: 'manager' as any, isActive: true },
    });

    const weekStart = new Date(getMondayStr());

    const results = await Promise.all(users.map(async (u) => {
      const gam = await this.getOrCreate(u.id);
      const weeklyXp = await this.txRepo
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.amount), 0)', 'sum')
        .where('tx.userId = :userId', { userId: u.id })
        .andWhere('tx.createdAt >= :weekStart', { weekStart })
        .getRawOne()
        .then(r => Number(r?.sum ?? 0));
      const achCount = await this.achRepo.count({ where: { userId: u.id } });
      const levelInfo = getLevel(gam.totalXp);
      return {
        id: u.id,
        fullName: u.fullName,
        color: u.color,
        avatarUrl: u.avatarUrl,
        totalXp: gam.totalXp,
        weeklyXp,
        currentStreak: gam.currentStreak,
        level: levelInfo.level,
        levelTitle: levelInfo.title,
        levelEmoji: levelInfo.emoji,
        achievementCount: achCount,
      };
    }));

    return results.sort((a, b) => b.weeklyXp - a.weeklyXp || b.totalXp - a.totalXp);
  }

  // ── Получить конфиг геймификации компании ─────────────────────
  async getGamificationConfig(companyId: string) {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    return {
      xpSettings: company?.xpSettings ?? DEFAULT_XP_SETTINGS,
      achievementSettings: company?.achievementSettings ?? DEFAULT_ACHIEVEMENT_SETTINGS,
    };
  }

  // ── Обновить конфиг геймификации компании ─────────────────────
  async updateGamificationConfig(
    companyId: string,
    data: { xpSettings?: Partial<XpSettingsData>; achievementSettings?: Partial<AchievementSettingsData> },
  ) {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (data.xpSettings) {
      company.xpSettings = { ...(company.xpSettings ?? DEFAULT_XP_SETTINGS), ...data.xpSettings };
    }
    if (data.achievementSettings) {
      company.achievementSettings = { ...(company.achievementSettings ?? DEFAULT_ACHIEVEMENT_SETTINGS), ...data.achievementSettings };
    }
    await this.companiesRepo.save(company);
    return this.getGamificationConfig(companyId);
  }
}
