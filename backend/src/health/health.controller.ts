import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    const dbOk = await this.dataSource.query('SELECT 1').then(() => true).catch(() => false);
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    return {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime),
      db: dbOk ? 'connected' : 'error',
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
        heap: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      },
    };
  }
}
