import { MigrationInterface, QueryRunner } from 'typeorm';

/** Run with old payment workers stopped: restores keys left by the old protocol. */
export class RecoverIdempotency1789084800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE idempotency_keys k
      SET payment_reference = p.reference, response_body = jsonb_build_object('reference', p.reference),
          status = 'COMPLETED'
      FROM payments p WHERE p.transaction_id = k.key AND k.status = 'IN_PROGRESS'`);
    await queryRunner.query(`DELETE FROM idempotency_keys k WHERE status = 'IN_PROGRESS'
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.transaction_id = k.key)`);
  }
  async down(): Promise<void> {
    // Data repair is intentionally irreversible; never recreate abandoned claims.
  }
}
