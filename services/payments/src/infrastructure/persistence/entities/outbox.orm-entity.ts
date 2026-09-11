import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A message waiting to reach the broker. Written in the same transaction as the
 * state change that produced it, which is what makes publication at-least-once
 * without the payment ever waiting on RabbitMQ.
 */
@Entity('outbox')
@Index('ix_outbox_unpublished', ['published_at', 'created_at'])
export class OutboxOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_outbox_aggregate')
  @Column({ type: 'varchar', length: 32 })
  aggregate_reference: string;

  @Column({ type: 'varchar', length: 64 })
  event_type: string;

  /** `object` rather than an index signature: see the note in the repository. */
  @Column({ type: 'jsonb' })
  payload: object;

  /** Null while the message is still owed to the broker. */
  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  next_attempt_at: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
