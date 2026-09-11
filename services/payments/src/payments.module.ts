import { PAYMENT_EXECUTION } from './domain/ports/payment-execution.port';
import { PostgresPaymentExecution } from './infrastructure/persistence/postgres-payment-execution';
import { HttpModule } from '@nestjs/axios';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from '@paynad/shared';

import { CompensatePaymentHandler } from './application/handlers/commands/compensate-payment.handler';
import { CreditDestinationWalletHandler } from './application/handlers/commands/credit-destination-wallet.handler';
import { DebitSourceWalletHandler } from './application/handlers/commands/debit-source-wallet.handler';
import { InitiatePaymentHandler } from './application/handlers/commands/initiate-payment.handler';
import {
  PaymentApprovedHandler,
  PaymentCompensatedHandler,
  PaymentDeclinedHandler,
} from './application/handlers/events/payment-lifecycle.handlers';
import { GetPaymentByReferenceHandler } from './application/handlers/queries/get-payment-by-reference.handler';
import { ListPaymentsHandler } from './application/handlers/queries/list-payments.handler';
import { PaymentSaga } from './application/sagas/payment.saga';
import { IdempotencyService } from './application/services/idempotency.service';

import { ACCOUNTS_PORT } from './domain/ports/accounts.port';
import { IDEMPOTENCY_REPOSITORY } from './domain/ports/idempotency.repository';
import { OUTBOX_REPOSITORY } from './domain/ports/outbox.repository';
import { PAYMENT_READ_PORT } from './domain/ports/payment-read.port';
import { PAYMENT_REPOSITORY } from './domain/ports/payment.repository';
import { TRANSACTIONS_PORT } from './domain/ports/transactions.port';
import { TRANSACTION_RUNNER } from './domain/ports/transaction-runner.port';

import { AccountsHttpClient } from './infrastructure/http/accounts.http-client';
import { CorrelationContext } from './infrastructure/http/correlation.context';
import { ReconciliationJob } from './infrastructure/jobs/reconciliation.job';
import { TRANSACTIONS_CLIENT } from './infrastructure/messaging/messaging.tokens';
import { OutboxRelay } from './infrastructure/messaging/outbox.relay';
import { TransactionsOutboxAdapter } from './infrastructure/messaging/transactions.outbox-adapter';
import { IdempotencyKeyOrmEntity } from './infrastructure/persistence/entities/idempotency-key.orm-entity';
import { OutboxOrmEntity } from './infrastructure/persistence/entities/outbox.orm-entity';
import { PaymentReadModel } from './infrastructure/persistence/entities/payment-read-model.orm-entity';
import { PaymentOrmEntity } from './infrastructure/persistence/entities/payment.orm-entity';
import { TransactionContext } from './infrastructure/persistence/transaction-context';
import { TypeOrmIdempotencyRepository } from './infrastructure/persistence/typeorm-idempotency.repository';
import { TypeOrmOutboxRepository } from './infrastructure/persistence/typeorm-outbox.repository';
import { TypeOrmPaymentReadRepository } from './infrastructure/persistence/typeorm-payment-read.repository';
import { TypeOrmPaymentRepository } from './infrastructure/persistence/typeorm-payment.repository';

import { CorrelationMiddleware } from './presentation/correlation.middleware';
import { PaymentsController } from './presentation/payments.controller';

const COMMAND_HANDLERS = [
  InitiatePaymentHandler,
  DebitSourceWalletHandler,
  CreditDestinationWalletHandler,
  CompensatePaymentHandler,
];

const QUERY_HANDLERS = [GetPaymentByReferenceHandler, ListPaymentsHandler];

const EVENT_HANDLERS = [PaymentApprovedHandler, PaymentDeclinedHandler, PaymentCompensatedHandler];

/**
 * The only place where the layers meet.
 *
 * Every port is bound to an implementation here, by token. Handlers ask for
 * `ACCOUNTS_PORT` and receive an HTTP client they know nothing about — swapping
 * it for a stub is a one-line change in this file and nowhere else.
 */
@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([
      PaymentOrmEntity,
      IdempotencyKeyOrmEntity,
      OutboxOrmEntity,
      PaymentReadModel,
    ]),
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: Number(config.get('HTTP_TIMEOUT_MS') ?? 3000),
        maxRedirects: 0,
      }),
    }),
    ClientsModule.registerAsync([
      {
        name: TRANSACTIONS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: Queue.TRANSACTIONS,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    // --- ports bound to their adapters ---
    { provide: PAYMENT_EXECUTION, useClass: PostgresPaymentExecution },
    { provide: ACCOUNTS_PORT, useClass: AccountsHttpClient },
    { provide: TRANSACTIONS_PORT, useClass: TransactionsOutboxAdapter },
    { provide: PAYMENT_REPOSITORY, useClass: TypeOrmPaymentRepository },
    { provide: PAYMENT_READ_PORT, useClass: TypeOrmPaymentReadRepository },
    { provide: OUTBOX_REPOSITORY, useClass: TypeOrmOutboxRepository },
    { provide: IDEMPOTENCY_REPOSITORY, useClass: TypeOrmIdempotencyRepository },
    { provide: TRANSACTION_RUNNER, useExisting: TransactionContext },

    // --- infrastructure ---
    TransactionContext,
    CorrelationContext,
    OutboxRelay,
    ReconciliationJob,

    // --- application ---
    PaymentSaga,
    IdempotencyService,
    ...COMMAND_HANDLERS,
    ...QUERY_HANDLERS,
    ...EVENT_HANDLERS,
  ],
})
export class PaymentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
