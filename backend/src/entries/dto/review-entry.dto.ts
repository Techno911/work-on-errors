import { IsString, IsArray, IsOptional, MaxLength, ArrayMaxSize } from 'class-validator';

export class ReviewEntryDto {
  @IsString()
  @MaxLength(20000)
  reviewText!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tagIds?: string[];
}
