import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import {
  PAYMENT_READ_PORT,
  PaymentReadPort,
  PaymentView,
} from '../../../domain/ports/payment-read.port';
import { GetPaymentByReferenceQuery } from '../../queries/get-payment-by-reference.query';

/** Reads the projection. The aggregate is never hydrated on this path. */
@QueryHandler(GetPaymentByReferenceQuery)
export class GetPaymentByReferenceHandler implements IQueryHandler<GetPaymentByReferenceQuery> {
  constructor(@Inject(PAYMENT_READ_PORT) private readonly payments: PaymentReadPort) {}

  async execute(query: GetPaymentByReferenceQuery): Promise<PaymentView> {
    const view = await this.payments.findByReference(query.reference);
    if (!view) {
      throw new PaymentNotFoundError(query.reference);
    }
    return view;
  }
}
