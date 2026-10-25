import { ForbiddenException } from '@nestjs/common';
import { RopBonusOfferService } from './rop-bonus-offer.service';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

/**
 * Отказ собственника от премии РОПа.
 *
 * Почему этот замок появился 16.09.2026. Владелец клиента написал «руководитель работает без премии,
 * можно её выключить в системе?» — на карточке предложения у него были только «Согласен» и
 * «Обсудить с трекером». Пока добавляли третий ответ, вскрылось, что и прежний отказ по
 * ссылке-лендингу выключением НЕ БЫЛ: он ставил только признак осознанного отказа, а сама премия
 * оставалась включённой. Для компании, где премия уже работала, это значит, что платформа
 * продолжает обещать РОПу деньги после отказа владельца. Тест ломали снятием `enabled: false`
 * из applyDecline — оба случая краснеют.
 */
describe('RopBonusOfferService — отказ владельца от премии', () => {
  const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

  const makeCompany = (over: Partial<Company> = {}): Company =>
    ({
      id: COMPANY_ID,
      name: 'клиента',
      ropBonus: {
        enabled: true,
        tiers: [
          { thresholdPct: 95, amount: 20000 },
          { thresholdPct: 80, amount: 16000 },
        ],
        payoutDay: 5,
      },
      ropBonusProposal: {},
      ...over,
    }) as Company;

  const owner = { id: 'u1', role: UserRole.OWNER, companyId: COMPANY_ID } as User;

  const makeService = (company: Company) => {
    const saved: Company[] = [];
    const companyRepo = {
      findOne: jest.fn().mockResolvedValue(company),
      save: jest.fn(async (c: Company) => {
        saved.push(c);
        return c;
      }),
      createQueryBuilder: jest.fn(() => ({
        where: () => ({ getOne: async () => company }),
      })),
    };
    const userRepo = { find: jest.fn().mockResolvedValue([]) };
    const notifications = { create: jest.fn() };
    const svc = new RopBonusOfferService(companyRepo as any, userRepo as any, notifications as any);
    return { svc, companyRepo, saved };
  };

  it('владелец отказался на главной — премия ВЫКЛЮЧЕНА, а не только помечена отказом', async () => {
    const company = makeCompany();
    const { svc, saved } = makeService(company);

    const res = await svc.declineSelf(owner);

    expect(res).toEqual({ alreadyResponded: false, decision: 'declined' });
    expect(saved).toHaveLength(1);
    expect(company.ropBonus.enabled).toBe(false);
    expect(company.ropBonus.declinedExplicitly).toBe(true);
    expect(company.ropBonusProposal.status).toBe('declined');
    expect(company.ropBonusProposal.decision).toBe('declined');
    expect(company.ropBonusProposal.respondedAt).toBeTruthy();
  });

  it('отказ не стирает настроенные условия — включить обратно можно тем же тумблером', async () => {
    const company = makeCompany();
    const { svc } = makeService(company);

    await svc.declineSelf(owner);

    expect(company.ropBonus.tiers).toHaveLength(2);
    expect(company.ropBonus.payoutDay).toBe(5);
  });

  it('повторный отказ ничего не переписывает (ответ уже дан)', async () => {
    const company = makeCompany({
      ropBonusProposal: { status: 'pending_review', decision: 'discuss', respondedAt: '2026-09-16T08:33:47.907Z' },
    });
    const { svc, saved } = makeService(company);

    const res = await svc.declineSelf(owner);

    expect(res).toEqual({ alreadyResponded: true, decision: 'discuss' });
    expect(saved).toHaveLength(0);
    expect(company.ropBonus.enabled).toBe(true);
  });

  it('решение о премии принимает собственник: РОПу отказ запрещён', async () => {
    const company = makeCompany();
    const { svc } = makeService(company);
    const reviewer = { id: 'u2', role: UserRole.REVIEWER, companyId: COMPANY_ID } as User;

    await expect(svc.declineSelf(reviewer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('отказ по ссылке-лендингу выключает премию так же, как на главной (прежняя дыра)', async () => {
    const company = makeCompany({ ropBonusProposal: { token: 'tkn', status: 'sent' } });
    const { svc } = makeService(company);

    const res = await svc.decline('tkn', owner);

    expect(res).toEqual({ alreadyResponded: false, decision: 'declined' });
    expect(company.ropBonus.enabled).toBe(false);
    expect(company.ropBonus.declinedExplicitly).toBe(true);
  });
});
