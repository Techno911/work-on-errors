import { IsString, IsOptional, MaxLength, IsDateString } from 'class-validator';

export class UpdateEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500000)
  transcription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  selfReviewCorrect?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  selfReviewImprove?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  selfReviewSuggestions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceCustom?: string;

  @IsOptional()
  @IsDateString()
  entryDate?: string;
}
