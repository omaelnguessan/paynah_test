import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReconciliationSchedule1789084802000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments
      ADD COLUMN reconciliation_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN next_reconciliation_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN last_reconciliation_error text`);
    await queryRunner.query(`CREATE INDEX ix_payments_reconciliation_due ON payments (next_reconciliation_at, updated_at)
      WHERE status IN ('Pending', 'Processing', 'CompensationPending')`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_payments_reconciliation_due');
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN reconciliation_attempts,
      DROP COLUMN next_reconciliation_at, DROP COLUMN last_reconciliation_error`);
  }
}
