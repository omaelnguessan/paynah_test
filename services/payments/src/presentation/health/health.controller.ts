import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { ApiEnvelopeResponse, ResponseCode, ResponseMessage } from '@paynad/shared';
import { OutboxOrmEntity } from '../../infrastructure/persistence/entities/outbox.orm-entity';
import { HealthDto } from './health.dto';

@ApiTags('health')
// Health probes are exempt from rate limiting.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Liveness, database readiness and outbox depth' })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: HealthDto,
  })
  async check(): Promise<HealthDto> {
    const database = await this.pingDatabase();
    return {
      service: 'payments',
      status: database === 'up' ? 'Healthy' : 'Degraded',
      database,
      // A depth that keeps climbing means the relay or the broker is in trouble.
      outbox_pending: database === 'up' ? await this.pendingOutbox() : -1,
      uptime_seconds: Math.floor(process.uptime()),
      checked_at: new Date().toISOString(),
    };
  }

  private async pingDatabase(): Promise<'up' | 'down'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async pendingOutbox(): Promise<number> {
    try {
      return await this.dataSource
        .getRepository(OutboxOrmEntity)
        .count({ where: { published_at: IsNull() } });
    } catch {
      return -1;
    }
  }
}
