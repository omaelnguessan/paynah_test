import { MigrationInterface, QueryRunner } from 'typeorm';

export class OutboxSchedule1789084803000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE outbox ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now()',
    );
    await queryRunner.query(
      'CREATE INDEX ix_outbox_due ON outbox (next_attempt_at, created_at) WHERE published_at IS NULL',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_outbox_due');
    await queryRunner.query('ALTER TABLE outbox DROP COLUMN next_attempt_at');
  }
}
