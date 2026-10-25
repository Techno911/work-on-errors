import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class ConfirmCandidateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  ruleText!: string;
}
