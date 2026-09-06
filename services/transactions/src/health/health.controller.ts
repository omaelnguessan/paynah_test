import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiEnvelopeResponse, ResponseCode, ResponseMessage } from '@paynad/shared';
import { HealthDto } from './health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and database readiness probe' })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: HealthDto,
  })
  async check(): Promise<HealthDto> {
    const database = await this.pingDatabase();
    return {
      service: 'transactions',
      status: database === 'up' ? 'Healthy' : 'Degraded',
      database,
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
}
