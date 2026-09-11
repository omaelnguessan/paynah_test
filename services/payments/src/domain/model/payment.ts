import { InvalidTransitionError } from '../errors/invalid-transition.error';
import { SameWalletError } from '../errors/wallet.errors';
import { DomainEvent } from '../events/domain-event';
import { PaymentApprovedEvent } from '../events/payment-approved.event';
import { PaymentCompensatedEvent } from '../events/payment-compensated.event';
import { PaymentDeclinedEvent } from '../events/payment-declined.event';
import { Money } from './money';
import { ALLOWED_TRANSITIONS, FailureReason, PaymentStatus } from './payment-status';
import { Reference } from './reference';

export interface InitiatePaymentInput {
  transactionId: string;
  money: Money;
  source: Reference;
  destination: Reference;
  description: string;
  metadata?: Readonly<Record<string, string>> | null;
}

/** Everything needed to bring a stored payment back to life, and nothing more. */
export interface PaymentSnapshot {
  reference: string;
  transactionId: string;
  amount: number;
  currency: string;
  sourceWallet: string;
  destinationWallet: string;
  description: string;
  status: PaymentStatus;
  failureReason: FailureReason | null;
  debitTransactionReference: string | null;
  creditTransactionReference: string | null;
  refundTransactionReference: string | null;
  metadata: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** Payment aggregate. State changes follow ALLOWED_TRANSITIONS. */
export class Payment {
  private _events: DomainEvent[] = [];

  private constructor(
    private readonly _reference: Reference,
    private readonly _transactionId: string,
    private readonly _money: Money,
    private readonly _source: Reference,
    private readonly _destination: Reference,
    private readonly _description: string,
    private readonly _metadata: Readonly<Record<string, string>> | null,
    private _status: PaymentStatus,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
    private _failureReason: FailureReason | null = null,
    private _debitTransactionReference: Reference | null = null,
    private _creditTransactionReference: Reference | null = null,
    private _refundTransactionReference: Reference | null = null,
    private _completedAt: Date | null = null,
  ) {}

  static initiate(input: InitiatePaymentInput, now: Date = new Date()): Payment {
    if (input.source.equals(input.destination)) {
      throw new SameWalletError(input.source.value);
    }
    return new Payment(
      Reference.generate('pay'),
      input.transactionId,
      input.money,
      input.source,
      input.destination,
      input.description,
      input.metadata ?? null,
      PaymentStatus.Pending,
      now,
      now,
    );
  }

  /** Rehydration from storage. Deliberately silent: replaying history is not a change. */
  static restore(snapshot: PaymentSnapshot): Payment {
    return new Payment(
      Reference.of('pay', snapshot.reference),
      snapshot.transactionId,
      Money.of(snapshot.amount, snapshot.currency as Money['currency']),
      Reference.of('wlt', snapshot.sourceWallet),
      Reference.of('wlt', snapshot.destinationWallet),
      snapshot.description,
      snapshot.metadata,
      snapshot.status,
      snapshot.createdAt,
      snapshot.updatedAt,
      snapshot.failureReason,
      snapshot.debitTransactionReference
        ? Reference.of('trx', snapshot.debitTransactionReference)
        : null,
      snapshot.creditTransactionReference
        ? Reference.of('trx', snapshot.creditTransactionReference)
        : null,
      snapshot.refundTransactionReference
        ? Reference.of('trx', snapshot.refundTransactionReference)
        : null,
      snapshot.completedAt,
    );
  }

  // --- behaviour -----------------------------------------------------------

  /** The source debit is about to be attempted. */
  markProcessing(now: Date = new Date()): void {
    this.transitionTo(PaymentStatus.Processing, now);
  }

  /** The source has been debited; the movement's reference is kept for audit. */
  markDebited(debitReference: Reference, now: Date = new Date()): void {
    this.assertCurrentlyIn(PaymentStatus.Processing);
    this._debitTransactionReference = debitReference;
    this._updatedAt = now;
  }

  approve(creditReference: Reference, now: Date = new Date()): void {
    this.transitionTo(PaymentStatus.Approved, now);
    this._creditTransactionReference = creditReference;
    this._completedAt = now;
    this._events.push(
      new PaymentApprovedEvent(
        this._reference,
        this._money,
        this.requireDebitReference(),
        creditReference,
        now,
      ),
    );
  }

  decline(reason: FailureReason, now: Date = new Date()): void {
    this.transitionTo(PaymentStatus.Declined, now);
    this._failureReason = reason;
    this._completedAt = now;
    this._events.push(new PaymentDeclinedEvent(this._reference, this._money, reason, now));
  }

  /** The source was refunded: the payment is unwound and leaves no net movement. */
  compensate(refundReference: Reference, now: Date = new Date()): void {
    this.transitionTo(PaymentStatus.Compensated, now);
    this._refundTransactionReference = refundReference;
    this._failureReason = this._failureReason ?? FailureReason.CREDIT_FAILED;
    this._completedAt = now;
    this._events.push(
      new PaymentCompensatedEvent(this._reference, this._money, refundReference, now),
    );
  }

  /**
   * The refund is owed but did not go through. Money is sitting in the wrong
   * place, so this state is deliberately not terminal: the reconciler retries it.
   */
  markCompensationPending(reason: FailureReason, now: Date = new Date()): void {
    this.transitionTo(PaymentStatus.CompensationPending, now);
    this._failureReason = reason;
  }

  private transitionTo(target: PaymentStatus, now: Date): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(target)) {
      throw new InvalidTransitionError(this._status, target);
    }
    this._status = target;
    this._updatedAt = now;
  }

  private assertCurrentlyIn(expected: PaymentStatus): void {
    if (this._status !== expected) {
      throw new InvalidTransitionError(this._status, expected);
    }
  }

  private requireDebitReference(): Reference {
    if (!this._debitTransactionReference) {
      throw new InvalidTransitionError(this._status, PaymentStatus.Approved);
    }
    return this._debitTransactionReference;
  }

  /** Hands over the accumulated events and forgets them, so they publish once. */
  pullEvents(): DomainEvent[] {
    const events = this._events;
    this._events = [];
    return events;
  }

  /** The idempotency key `accounts` sees for each leg of the saga. */
  movementKey(leg: 'debit' | 'credit' | 'refund'): string {
    return leg === 'debit' ? this._reference.value : `${this._reference.value}:${leg}`;
  }

  // --- state ---------------------------------------------------------------

  get reference(): Reference {
    return this._reference;
  }

  get transactionId(): string {
    return this._transactionId;
  }

  get money(): Money {
    return this._money;
  }

  get source(): Reference {
    return this._source;
  }

  get destination(): Reference {
    return this._destination;
  }

  get description(): string {
    return this._description;
  }

  get metadata(): Readonly<Record<string, string>> | null {
    return this._metadata;
  }

  get status(): PaymentStatus {
    return this._status;
  }

  get failureReason(): FailureReason | null {
    return this._failureReason;
  }

  get debitTransactionReference(): Reference | null {
    return this._debitTransactionReference;
  }

  get creditTransactionReference(): Reference | null {
    return this._creditTransactionReference;
  }

  get refundTransactionReference(): Reference | null {
    return this._refundTransactionReference;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get completedAt(): Date | null {
    return this._completedAt;
  }

  /** A flat copy for the persistence mapper. The aggregate stays the only writer. */
  toSnapshot(): PaymentSnapshot {
    return {
      reference: this._reference.value,
      transactionId: this._transactionId,
      amount: this._money.amount,
      currency: this._money.currency,
      sourceWallet: this._source.value,
      destinationWallet: this._destination.value,
      description: this._description,
      status: this._status,
      failureReason: this._failureReason,
      debitTransactionReference: this._debitTransactionReference?.value ?? null,
      creditTransactionReference: this._creditTransactionReference?.value ?? null,
      refundTransactionReference: this._refundTransactionReference?.value ?? null,
      metadata: this._metadata ? { ...this._metadata } : null,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      completedAt: this._completedAt,
    };
  }
}
