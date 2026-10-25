import { IsString, IsEnum, IsInt, IsDateString, IsOptional, MaxLength, Min, Max } from 'class-validator';
import { EntryType } from '../enums/entry-type.enum';

export class CreateEntryDto {
  @IsString()
  @MaxLength(64)
  sprintId!: string;

  @IsString()
  @MaxLength(64)
  managerId!: string;

  @IsString()
  @MaxLength(64)
  companyId!: string;

  @IsEnum(EntryType)
  type!: EntryType;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  entryNumber!: number;

  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceCustom?: string;

  // Импорт из CRM: staged-файл записи + метаданные звонка
  @IsOptional()
  @IsString()
  @MaxLength(200)
  stagedRecordingId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  crmCallId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  crmProvider?: string;

  @IsOptional()
  crmCallMetadata?: { phone?: string; direction?: string; durationSec?: number; callStartedAt?: string };

  @IsOptional()
  @IsString()
  @MaxLength(500000)
  transcription?: string;
}
