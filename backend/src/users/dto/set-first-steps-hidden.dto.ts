import { IsBoolean } from 'class-validator';

/**
 * Личное скрытие учебной карточки «Первые шаги». Только {hidden: boolean} — ни userId,
 * ни companyId, ни роли из тела не принимаются: контекст определяет сервер по токену.
 */
export class SetFirstStepsHiddenDto {
  @IsBoolean()
  hidden!: boolean;
}
