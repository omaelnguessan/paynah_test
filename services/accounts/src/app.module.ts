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

    ThrottlerModule.forRoot(platformThrottlerOptions(throttlerSettingsFrom(process.env))),

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
