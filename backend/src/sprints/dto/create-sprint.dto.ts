import { IsString, IsDateString, IsOptional, IsEnum } from 'class-validator';
import { SprintStatus } from '../enums/sprint-status.enum';

export class CreateSprintDto {
  @IsString()
  companyId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  label!: string;

  @IsOptional()
  @IsEnum(SprintStatus)
  status?: SprintStatus;
}
