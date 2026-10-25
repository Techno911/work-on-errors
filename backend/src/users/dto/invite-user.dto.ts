import { IsEmail, IsString, IsEnum, IsUUID, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../enums/user-role.enum';

export class InviteUserDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsUUID()
  companyId!: string;
}
