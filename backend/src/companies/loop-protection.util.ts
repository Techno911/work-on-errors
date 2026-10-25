import { Company } from './entities/company.entity';

export interface LoopProtection {
  protected: boolean;
  reasons: string[]; // 'no_owner_channels' | 'rop_discipline_not_chosen'
}

/**
 * «Петля защищена» — минимальная конфигурация, при которой цикл разбора ошибок
 * не умирает молча (урок пилота одного клиента: менеджеры сдали 40 записей, РОП проверил 4,
 * ни премии, ни отчётов владельцу включено не было — петля умерла за неделю).
 *
 * Два условия:
 *  1) владелец подключён хотя бы к одному каналу отчётов (email или Telegram);
 *  2) контур дисциплины РОПа выбран явно: премия включена ИЛИ владелец
 *     осознанно от неё отказался (declinedExplicitly).
 */
export function assessLoopProtection(company: Company): LoopProtection {
  const reasons: string[] = [];

  const wa = company.reportChannels?.weeklyAccountability;
  const hasChannel = (wa?.emails?.length ?? 0) > 0 || (wa?.telegramChatIds?.length ?? 0) > 0;
  if (!hasChannel) reasons.push('no_owner_channels');

  const bonus = company.ropBonus;
  const disciplineChosen = bonus?.enabled === true || bonus?.declinedExplicitly === true;
  if (!disciplineChosen) reasons.push('rop_discipline_not_chosen');

  return { protected: reasons.length === 0, reasons };
}
