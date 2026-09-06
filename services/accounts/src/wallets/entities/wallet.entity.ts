import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  Currency,
  WalletStatus,
  bigintTransformer,
} from '@paynad/shared';
import { User } from '../../users/entities/user.entity';

@Entity('wallets')
@Index('ix_wallets_user_id', ['user_id'])
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Server-generated `wlt_…`. */
  @Index('uq_wallets_reference', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  reference: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, (user) => user.wallets, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'char', length: 3 })
  currency: Currency;

  /**
   * Integer minor units. `bigint` maps to a string in the driver, so every
   * read goes through a transformer to keep the domain in `number`.
   */
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  balance: number;

  /** Funds held by an in-flight operation; `available = balance - reserved`. */
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  reserved_amount: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 16, default: WalletStatus.ACTIVE })
  status: WalletStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
