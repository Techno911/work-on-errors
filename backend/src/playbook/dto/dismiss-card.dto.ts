import { IsString, IsOptional, MaxLength } from 'class-validator';

export class DismissCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
