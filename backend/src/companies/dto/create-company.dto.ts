import { IsString, MinLength, IsOptional, IsInt, Min, Max, IsBoolean, IsArray, IsIn, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { XpSettingsData, AchievementSettingsData } from '../../gamification/types/gamification-settings.types';
import type { ReportChannelsData, TranscriptionSettingsData } from '../entities/company.entity';

// Раньше reviewNorms/ropBonus были типизированы только TS-интерфейсом (только compile-time) —
// PATCH /companies с {minThresholdPct:-50} обходил отсечку (выплата премии вместо 0), а
// произвольные лишние поля проходили молча (CALC-DTO). Явные nested-DTO дают рантайм-валидацию
// формы И диапазонов через тот же глобальный ValidationPipe({whitelist,transform}), что и везде.
class ReviewNormsDto {
  @IsInt() @Min(0) minReviewsPerWeek!: number;
  @IsInt() @Min(1) maxHoursToRespond!: number;
  @IsInt() @Min(0) minReviewCharsAvg!: number;
  @IsInt() @Min(0) @Max(100) qualityThresholdPct!: number;
}

class RopBonusTierDto {
  @IsInt() @Min(0) @Max(100) thresholdPct!: number;
  @IsInt() @Min(0) amount!: number;
}

class RopBonusDto {
  @IsBoolean() enabled!: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RopBonusTierDto)
  tiers?: RopBonusTierDto[];

  @IsOptional() @IsNumber() @Min(0) baseAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minThresholdPct?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(28) payoutDay?: number | null;
  @IsOptional() @IsBoolean() workdaysOnly?: boolean;
  @IsOptional() @IsBoolean() declinedExplicitly?: boolean;
}

export class CreateCompanyDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  // IANA-таймзона клиента: по ней считаются граница недели, дедлайны и утренние отчёты
  @IsOptional()
  @IsIn([
    'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg',
    'Asia/Omsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk',
    'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  ])
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  callsPerWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  chatsPerWeek?: number;

  @IsOptional()
  @IsString()
  managerDeadlineDay?: string;

  @IsOptional()
  @IsString()
  reviewerDeadlineDay?: string;

  @IsOptional()
  @IsBoolean()
  callsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  chatsEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSelfReviewCorrectChars?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSelfReviewImproveChars?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSelfReviewSuggestionsChars?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minReviewChars?: number;

  @IsOptional()
  @IsBoolean()
  onboardingCompleted?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callSources?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chatSources?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdGoodCalls?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdGoodChats?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdGreatCalls?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdGreatChats?: number;

  @IsOptional()
  @IsBoolean()
  gamificationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reviewerCanEditGamification?: boolean;

  @IsOptional()
  @IsBoolean()
  reviewerCanEditReviewTemplates?: boolean;

  @IsOptional()
  xpSettings?: XpSettingsData;

  @IsOptional()
  achievementSettings?: AchievementSettingsData;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReviewNormsDto)
  reviewNorms?: ReviewNormsDto;

  @IsOptional()
  reportChannels?: ReportChannelsData;

  @IsOptional()
  @ValidateNested()
  @Type(() => RopBonusDto)
  ropBonus?: RopBonusDto;

  @IsOptional()
  transcription?: TranscriptionSettingsData;
}
