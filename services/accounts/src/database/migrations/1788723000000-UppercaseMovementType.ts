import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Movement types become upper case platform-wide (`CREDIT`, `DEBIT`, `REFUND`),
 * so `accounts` and `transactions` speak one vocabulary.
 *
 * The ledger is append-only by trigger, which is exactly what should stop a
 * casual amendment — so the trigger is dropped for the length of this migration
 * and recreated immediately, making the one legitimate rewrite explicit and
 * auditable in the migration history.
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
