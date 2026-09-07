import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  EnvelopeThrottlerGuard,
  PlatformLoggerModule,
  platformThrottlerOptions,
  throttlerSettingsFrom,
} from '@paynad/shared';
import { dataSourceOptions } from './infrastructure/config/data-source';
import { validateEnv } from './infrastructure/config/env.config';
import { PaymentsModule } from './payments.module';
import { HealthModule } from './presentation/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Rate limiting is a module, not a proxy rule: the API defends itself even
    // when it is reached directly, and the budgets travel with the code.
    ThrottlerModule.forRoot(platformThrottlerOptions(throttlerSettingsFrom(process.env))),
    PlatformLoggerModule({
      serviceName: 'payments',
      pretty: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
    ScheduleModule.forRoot(),
    HealthModule,
    PaymentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: EnvelopeThrottlerGuard }],
})
export class AppModule {}
