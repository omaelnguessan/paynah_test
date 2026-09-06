import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The key is the primary key, which is the whole point: claiming it is an
 * INSERT, and the constraint decides who wins a race.
 */
@Entity('idempotency_keys')
export class IdempotencyKeyOrmEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  /** Hash of the request payload, so the same key with another body is caught. */
  @Column({ type: 'char', length: 64 })
  request_hash: string;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  payment_reference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  response_body: object | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
