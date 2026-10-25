import { IsString, IsOptional, MaxLength, IsArray, ValidateNested, IsIn, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

export class PlaybookExampleDto {
  @IsIn(['bad', 'good'])
  kind!: 'bad' | 'good';

  @IsString()
  @MaxLength(1000)
  quote!: string;

  @IsOptional()
  @IsString()
  entryId?: string;
}

export class UpdatePlaybookCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  ruleText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlaybookExampleDto)
  examples?: PlaybookExampleDto[];
}

export class CreateManualCardDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  ruleText?: string;
}
