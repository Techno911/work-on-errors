import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  // AUDIT-0710: trim до IsEmail — иначе паста «mail@example.invalid␣» падала в 400 «must be an email».
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  fullName!: string;

  // AUDIT-0710: регистрация впускает только по приглашению — код инвайта компании…
  @IsOptional()
  @IsString()
  inviteCode?: string;

  // …или по токену оферты компании (OfferPage). Без обоих — 403 (см. AuthService.register).
  @IsOptional()
  @IsString()
  offerToken?: string;
}
