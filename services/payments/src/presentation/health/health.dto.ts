import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ example: 'payments' })
  service: string;

  @ApiProperty({ example: 'Healthy', enum: ['Healthy', 'Degraded'] })
  status: 'Healthy' | 'Degraded';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  database: 'up' | 'down';

  @ApiProperty({ example: 3, description: 'Messages still owed to the broker' })
  outbox_pending: number;

  @ApiProperty({ example: 42 })
  uptime_seconds: number;

  @ApiProperty({ example: '2026-09-06T10:15:00.000Z' })
  checked_at: string;
}
