import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformLoggerModule } from '@paynad/shared';
import { dataSourceOptions } from './config/data-source';
import { validateEnv } from './config/env.config';
import { HealthModule } from './health/health.module';
import { TransactionsModule } from './transactions/transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // One logger config for the platform: every line carries service_name and
    // correlation_id, so a single grep follows a payment across all three services.
    PlatformLoggerModule({
      serviceName: 'transactions',
      pretty: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
    HealthModule,
    TransactionsModule,
  ],
})
export class AppModule {}
