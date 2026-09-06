import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformLoggerModule } from '@paynad/shared';
import { dataSourceOptions } from './infrastructure/config/data-source';
import { validateEnv } from './infrastructure/config/env.config';
import { PaymentsModule } from './payments.module';
import { HealthModule } from './presentation/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PlatformLoggerModule({
      serviceName: 'payments',
      pretty: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
    ScheduleModule.forRoot(),
    HealthModule,
    PaymentsModule,
  ],
})
export class AppModule {}
