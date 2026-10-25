import { IsString, IsOptional } from 'class-validator';

export class CreateErrorTagDto {
  @IsString()
  companyId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;
}
