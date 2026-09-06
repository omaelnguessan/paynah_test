import { MigrationInterface, QueryRunner } from "typeorm";

export class InitTransactions1788721105658 implements MigrationInterface {
    name = 'InitTransactions1788721105658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() lives in uuid-ossp, which is not enabled by default.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(32) NOT NULL, "transaction_id" character varying(64) NOT NULL, "payment_reference" character varying(32) NOT NULL, "type" character varying(16) NOT NULL, "wallet_reference" character varying(32) NOT NULL, "user_reference" character varying(32) NOT NULL, "amount" bigint NOT NULL, "currency" character(3) NOT NULL, "description" character varying(255) NOT NULL, "status" character varying(16) NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_transactions_reference" ON "transactions" ("reference") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_transactions_transaction_id" ON "transactions" ("transaction_id") `);
        await queryRunner.query(`CREATE INDEX "ix_transactions_payment_reference" ON "transactions" ("payment_reference") `);
        await queryRunner.query(`CREATE INDEX "ix_transactions_user_occurred" ON "transactions" ("user_reference", "occurred_at" DESC) `);
        await queryRunner.query(`CREATE INDEX "ix_transactions_wallet_occurred" ON "transactions" ("wallet_reference", "occurred_at" DESC) `);

        // Append-only, enforced by the database rather than by convention: a
        // correction is a new REFUND row, never an amendment of an existing one.
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION transactions_append_only() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'transactions is append-only (attempted %)', TG_OP;
            END;
            $$ LANGUAGE plpgsql
        `);
        await queryRunner.query(`
            CREATE TRIGGER trg_transactions_append_only
            BEFORE UPDATE OR DELETE ON "transactions"
            FOR EACH ROW EXECUTE FUNCTION transactions_append_only()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS trg_transactions_append_only ON "transactions"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS transactions_append_only()`);
        await queryRunner.query(`DROP INDEX "public"."ix_transactions_wallet_occurred"`);
        await queryRunner.query(`DROP INDEX "public"."ix_transactions_user_occurred"`);
        await queryRunner.query(`DROP INDEX "public"."ix_transactions_payment_reference"`);
        await queryRunner.query(`DROP INDEX "public"."uq_transactions_transaction_id"`);
        await queryRunner.query(`DROP INDEX "public"."uq_transactions_reference"`);
        await queryRunner.query(`DROP TABLE "transactions"`);
    }

}
