import { MigrationInterface, QueryRunner } from "typeorm";

export class InitAccounts1788720130245 implements MigrationInterface {
    name = 'InitAccounts1788720130245'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() lives in uuid-ossp, which is not enabled by default.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(32) NOT NULL, "customer_firstname" character varying(100) NOT NULL, "customer_lastname" character varying(100) NOT NULL, "customer_email" character varying(320) NOT NULL, "customer_phone_number" character varying(32) NOT NULL, "customer_address" character varying(255), "customer_city" character varying(100), "customer_country" character(2), "customer_zip_code" character varying(16), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_reference" ON "users" ("reference") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("customer_email") `);
        await queryRunner.query(`CREATE TABLE "wallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(32) NOT NULL, "user_id" uuid NOT NULL, "currency" character(3) NOT NULL, "balance" bigint NOT NULL DEFAULT '0', "reserved_amount" bigint NOT NULL DEFAULT '0', "label" character varying(100), "status" character varying(16) NOT NULL DEFAULT 'Active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8402e5df5a30a229380e83e4f7e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_wallets_reference" ON "wallets" ("reference") `);
        await queryRunner.query(`CREATE INDEX "ix_wallets_user_id" ON "wallets" ("user_id") `);
        await queryRunner.query(`CREATE TABLE "ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(32) NOT NULL, "wallet_id" uuid NOT NULL, "transaction_id" character varying(64) NOT NULL, "type" character varying(16) NOT NULL, "amount" bigint NOT NULL, "currency" character(3) NOT NULL, "balance_before" bigint NOT NULL, "balance_after" bigint NOT NULL, "description" character varying(255) NOT NULL, "payment_reference" character varying(32), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_ledger_entries_wallet_transaction" UNIQUE ("wallet_id", "transaction_id"), CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_ledger_entries_reference" ON "ledger_entries" ("reference") `);
        await queryRunner.query(`CREATE INDEX "ix_ledger_entries_payment_reference" ON "ledger_entries" ("payment_reference") `);
        await queryRunner.query(`CREATE INDEX "ix_ledger_entries_wallet_created" ON "ledger_entries" ("wallet_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "wallets" ADD CONSTRAINT "FK_92558c08091598f7a4439586cda" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // The ledger is append-only, and that is enforced by the database rather
        // than by convention: no code path, migration or psql session can amend
        // a movement once it is written.
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'ledger_entries is append-only (attempted %)', TG_OP;
            END;
            $$ LANGUAGE plpgsql
        `);
        await queryRunner.query(`
            CREATE TRIGGER trg_ledger_entries_append_only
            BEFORE UPDATE OR DELETE ON "ledger_entries"
            FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS trg_ledger_entries_append_only ON "ledger_entries"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS ledger_entries_append_only()`);
        await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "FK_92558c08091598f7a4439586cda"`);
        await queryRunner.query(`DROP INDEX "public"."ix_ledger_entries_wallet_created"`);
        await queryRunner.query(`DROP INDEX "public"."ix_ledger_entries_payment_reference"`);
        await queryRunner.query(`DROP INDEX "public"."uq_ledger_entries_reference"`);
        await queryRunner.query(`DROP TABLE "ledger_entries"`);
        await queryRunner.query(`DROP INDEX "public"."ix_wallets_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."uq_wallets_reference"`);
        await queryRunner.query(`DROP TABLE "wallets"`);
        await queryRunner.query(`DROP INDEX "public"."uq_users_email"`);
        await queryRunner.query(`DROP INDEX "public"."uq_users_reference"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
