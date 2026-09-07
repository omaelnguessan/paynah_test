import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  EnvelopeThrottlerGuard,
  PlatformLoggerModule,
  platformThrottlerOptions,
  throttlerSettingsFrom,
} from '@paynad/shared';
import { dataSourceOptions } from './config/data-source';
import { validateEnv } from './config/env.config';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Rate limiting is a module, not a proxy rule: the API defends itself even
    // when it is reached directly, and the budgets travel with the code.
    ThrottlerModule.forRoot(platformThrottlerOptions(throttlerSettingsFrom(process.env))),
    // One logger config for the platform: every line carries service_name and
    // correlation_id, so a single grep follows a payment across all three services.
    PlatformLoggerModule({
      serviceName: 'accounts',
      pretty: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
    HealthModule,
    UsersModule,
    WalletsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: EnvelopeThrottlerGuard }],
})
export class AppModule {}
