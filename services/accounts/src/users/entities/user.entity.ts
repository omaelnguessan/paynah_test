import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Wallet } from '../../wallets/entities/wallet.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Server-generated `usr_…`; the only identifier exposed over HTTP. */
  @Index('uq_users_reference', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  reference: string;

  @Column({ type: 'varchar', length: 100 })
  customer_firstname: string;

  @Column({ type: 'varchar', length: 100 })
  customer_lastname: string;

  @Index('uq_users_email', { unique: true })
  @Column({ type: 'varchar', length: 320 })
  customer_email: string;

  @Column({ type: 'varchar', length: 32 })
  customer_phone_number: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_address: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  customer_city: string | null;

  /** ISO 3166-1 alpha-2, upper case. */
  @Column({ type: 'char', length: 2, nullable: true })
  customer_country: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  customer_zip_code: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets: Wallet[];
}
