import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalizes movement types to CREDIT, DEBIT and REFUND.
 * Temporarily removes the append-only trigger, then reinstates it after the update.
 */
export class UppercaseMovementType1788723000000 implements MigrationInterface {
  name = 'UppercaseMovementType1788723000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_ledger_entries_append_only ON "ledger_entries"`,
    );
    await queryRunner.query(`UPDATE "ledger_entries" SET "type" = upper("type")`);
    await queryRunner.query(`
      CREATE TRIGGER trg_ledger_entries_append_only
      BEFORE UPDATE OR DELETE ON "ledger_entries"
      FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_ledger_entries_append_only ON "ledger_entries"`,
    );
    await queryRunner.query(`UPDATE "ledger_entries" SET "type" = initcap("type")`);
    await queryRunner.query(`
      CREATE TRIGGER trg_ledger_entries_append_only
      BEFORE UPDATE OR DELETE ON "ledger_entries"
      FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only()
    `);
  }
}
