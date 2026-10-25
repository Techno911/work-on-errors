import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/entities/user.entity';

interface JwtPayload {
  imp?: boolean;
  sub: string;
  email: string;
  role: string;
  companyId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Сессия истекла. Войдите снова.');
    }
    // Маркер «Глазами» из claim imp кладём на сам entity (без {...user}: спред
    // терял бы prototype и правила сериализации @Exclude). Далее личные мутации
    // (подтверждение чтения разбора) сервер отклоняет 403.
    (user as User & { impersonated?: boolean }).impersonated = payload.imp === true;
    return user;
  }
}
