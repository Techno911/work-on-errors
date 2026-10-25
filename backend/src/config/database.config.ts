import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get('DB_USERNAME', 'ro_user'),
  password: configService.get('DB_PASSWORD', 'ro_password'),
  database: configService.get('DB_NAME', 'ro_db'),
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize:
    configService.get('NODE_ENV') !== 'production' ||
    configService.get('DB_SYNC') === 'true',
  logging: configService.get('NODE_ENV') !== 'production',
  // Connection pool tuned for 2GB RAM server
  extra: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
});
