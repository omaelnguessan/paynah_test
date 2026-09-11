import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import {
  Currency,
  TransactionType,
  bigintTransformer,
} from '@paynad/shared';

/** Append-only balance movements. The unique (wallet_id, transaction_id) key prevents duplicate movements. */
@Entity('ledger_entries')
@Unique('uq_ledger_entries_wallet_transaction', ['wallet_id', 'transaction_id'])
@Index('ix_ledger_entries_wallet_created', ['wallet_id', 'created_at'])
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Server-generated `trx_…`, the movement's own reference. */
  @Index('uq_ledger_entries_reference', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  reference: string;

  @Column({ type: 'uuid' })
  wallet_id: string;

  /** Caller-supplied idempotency key. Allows _ and : for derived saga movement keys. */
  @Column({ type: 'varchar', length: 64 })
  transaction_id: string;

  @Column({ type: 'varchar', length: 16 })
  type: TransactionType;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({ type: 'char', length: 3 })
  currency: Currency;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  balance_before: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  balance_after: number;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  /** Correlates the movement with the payments saga that caused it. */
  @Index('ix_ledger_entries_payment_reference')
  @Column({ type: 'varchar', length: 32, nullable: true })
  payment_reference: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
