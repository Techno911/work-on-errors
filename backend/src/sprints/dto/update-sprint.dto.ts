import { IsOptional, IsEnum } from 'class-validator';
import { SprintStatus } from '../enums/sprint-status.enum';

export class UpdateSprintDto {
  @IsOptional()
  @IsEnum(SprintStatus)
  status?: SprintStatus;
}
