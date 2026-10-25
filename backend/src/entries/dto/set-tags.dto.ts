import { IsArray, IsString, ArrayMaxSize, MaxLength } from 'class-validator';

export class SetTagsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tagIds!: string[];
}
