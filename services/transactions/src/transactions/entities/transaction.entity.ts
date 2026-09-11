import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  Currency,
  TransactionStatus,
  TransactionType,
  bigintTransformer,
} from '@paynad/shared';

/**
 * Append-only ledger. Corrections use REFUND entries.
 * Indexes support history queries by user or wallet.
 */
@Entity('transactions')
@Index('ix_transactions_wallet_occurred', ['wallet_reference', 'occurred_at'])
@Index('ix_transactions_user_occurred', ['user_reference', 'occurred_at'])
@Index('ix_transactions_payment_reference', ['payment_reference'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Server-generated `trx_…`; what a caller queries with afterwards. */
  @Index('uq_transactions_reference', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  reference: string;

  /** Caller-supplied idempotency key, unique across the whole ledger. */
  @Index('uq_transactions_transaction_id', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  transaction_id: string;

  @Column({ type: 'varchar', length: 32 })
  payment_reference: string;

  @Column({ type: 'varchar', length: 16 })
  type: TransactionType;

  @Column({ type: 'varchar', length: 32 })
  wallet_reference: string;

  @Column({ type: 'varchar', length: 32 })
  user_reference: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({ type: 'char', length: 3 })
  currency: Currency;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'varchar', length: 16 })
  status: TransactionStatus;

  /** Business time: when the movement happened, per the emitting service. */
  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  /** Insertion time: when this service learned about it. Deliberately distinct. */
  @CreateDateColumn({ type: 'timestamptz' })
  recorded_at: Date;
}
