import { IsNotEmpty, ValidateNested, IsNumber, IsBoolean, IsOptional, Min, Max, IsInt, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

// AUDIT-0710 (L1): эндпоинт падал 500 на пустом теле — `dto.draft` читался без проверки.
export class RopBonusDraftDto {
  @IsNumber()
  @Min(0)
  baseAmount!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  minThresholdPct!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  payoutDay!: number | null;

  @IsBoolean()
  workdaysOnly!: boolean;
}

export class PrepareProposalDto {
  @IsNotEmpty({ message: 'Укажите условия премии (draft)' })
  @ValidateNested()
  @Type(() => RopBonusDraftDto)
  draft!: RopBonusDraftDto;

  @IsOptional()
  @IsIn(['contract', 'profile'])
  source?: 'contract' | 'profile';
}
