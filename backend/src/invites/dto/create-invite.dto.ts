import { IsEmail, IsString, IsOptional, IsIn } from 'class-validator';

export class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  @IsIn(['manager', 'reviewer', 'owner'])
  role?: string;

  @IsString()
  companyId!: string;
}
