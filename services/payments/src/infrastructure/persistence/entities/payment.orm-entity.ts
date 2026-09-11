import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '@paynad/shared';

/**
 * The relational shape of a payment. This is not the aggregate: it carries
 * decorators, column types and nullability, and knows nothing about transitions.
 * `PaymentOrmMapper` is the only thing that converts between the two.
 */
@Entity('payments')
@Index('ix_payments_status_updated', ['status', 'updated_at'])
export class PaymentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_payments_reference', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  reference: string;

  /** Caller-supplied idempotency key. */
  @Index('uq_payments_transaction_id', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  transaction_id: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Index('ix_payments_source_wallet')
  @Column({ type: 'varchar', length: 32 })
  source_wallet_reference: string;

  @Column({ type: 'varchar', length: 32 })
  destination_wallet_reference: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'varchar', length: 24 })
  status: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  failure_reason: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  debit_transaction_reference: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  credit_transaction_reference: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  refund_transaction_reference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, string> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;
}
