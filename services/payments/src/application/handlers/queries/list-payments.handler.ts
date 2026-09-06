import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  PAYMENT_READ_PORT,
  PaymentReadPort,
  PaymentView,
} from '../../../domain/ports/payment-read.port';
import { ListPaymentsQuery } from '../../queries/list-payments.query';

export interface ListPaymentsResult {
  items: PaymentView[];
  total: number;
}

@QueryHandler(ListPaymentsQuery)
export class ListPaymentsHandler implements IQueryHandler<ListPaymentsQuery> {
  constructor(@Inject(PAYMENT_READ_PORT) private readonly payments: PaymentReadPort) {}

  execute(query: ListPaymentsQuery): Promise<ListPaymentsResult> {
    return this.payments.findPage({
      page: query.page,
      perPage: query.perPage,
      status: query.status,
      sourceWallet: query.sourceWallet,
    });
  }
}
