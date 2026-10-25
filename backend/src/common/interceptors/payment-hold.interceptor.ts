import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { Company } from '../../companies/entities/company.entity';
import { User } from '../../users/entities/user.entity';
import { TEAM_ROLES, UserRole } from '../../users/enums/user-role.enum';

/**
 * Приостановка работы за неоплату: замок на стороне сервера.
 *
 * Экран приостановки во фронте это вежливость, а не защита: интерфейс обходится прямым
 * запросом к API, и тогда «дальше никуда не продвинуться» окажется неправдой. Поэтому
 * состояние принуждается здесь, глобально, а не проверкой в каждом контроллере: правило,
 * которое надо помнить при написании нового эндпоинта, регрессирует само по себе.
 *
 * ПОЧЕМУ ИНТЕРЦЕПТОР, А НЕ GUARD (выстрадано живым прогоном на проде 10.08.2026). Первая
 * редакция была глобальным guard, и она пропускала ВСЁ: глобальные guard'ы в Nest отрабатывают
 * раньше контроллерных, то есть до JwtAuthGuard, и на этот момент пользователя в запросе ещё
 * нет. Замок честно видел «запрос без пользователя», считал его публичным и пропускал. Тесты
 * при этом были зелёными, потому что пользователя в них подставляю я сам. Интерцептор
 * выполняется после всех guard'ов, когда токен уже разобран, и видит того, кто пришёл.
 *
 * Кого закрывает: только команду клиента (владелец, РОП, менеджеры). Наши роли работают как
 * обычно, иначе трекер не сможет вести компанию, а владелец ЧиП снять приостановку.
 *
 * Что остаётся открытым и почему: вход, обновление сессии, выход и чтение своего состояния.
 * Без них человек не увидит объяснения и не сможет выйти, а получит белый экран с ошибкой.
 */
@Injectable()
export class PaymentHoldInterceptor implements NestInterceptor {
  /** Признак отказа для фронта: по нему поднимается экран приостановки, а не общая ошибка. */
  static readonly ERROR_CODE = 'PAYMENT_HOLD';

  /**
   * Пути, открытые при приостановке. Сравниваются по началу пути после /api.
   * Список намеренно короткий: всё, чего здесь нет, закрыто.
   */
  private static readonly ALLOWED_PREFIXES = [
    '/auth/login',
    '/auth/refresh',
    '/auth/logout',
    '/auth/me',
    '/companies/access-state',
    '/health',
  ];

  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const user = request?.user as User | undefined;

    // Публичные пути (оферта, ссылка на разбор, вебхук Telegram) идут без пользователя.
    if (!user || !user.role) return next.handle();
    if (!TEAM_ROLES.includes(user.role as UserRole)) return next.handle();
    if (!user.companyId) return next.handle();

    if (this.isAllowedPath(String(request?.url ?? ''))) return next.handle();

    const held = await this.isHeld(user);
    if (!held) return next.handle();

    // Машинный признак кладём в поле error, а не в своё: глобальный фильтр исключений
    // пересобирает тело ответа и оставляет из него только statusCode, message и error.
    // Собственное поле code потерялось бы по дороге, и фронт никогда бы его не увидел.
    throw new ForbiddenException({
      error: PaymentHoldInterceptor.ERROR_CODE,
      message: 'Работа платформы для вашей компании приостановлена. Обратитесь к собственнику компании.',
    });
  }

  /** Путь запроса без префикса /api и без строки параметров. */
  private isAllowedPath(url: string): boolean {
    const path = url.split('?')[0].replace(/^\/api/, '');
    return PaymentHoldInterceptor.ALLOWED_PREFIXES.some(
      prefix => path === prefix || path.startsWith(prefix + '/'),
    );
  }

  /**
   * Состояние приостановки. Стратегия JWT подгружает компанию частично, поэтому отсутствие
   * поля означает «не знаю», а не «не приостановлена»: в этом случае спрашиваем базу.
   * Тихий дефолт здесь стоил бы открытого доступа при приостановленной компании.
   */
  private async isHeld(user: User): Promise<boolean> {
    const known = user.company?.paymentHold;
    if (typeof known === 'boolean') return known;
    const company = await this.companies.findOne({
      where: { id: user.companyId as string },
      select: { id: true, paymentHold: true },
    });
    return company?.paymentHold === true;
  }
}
