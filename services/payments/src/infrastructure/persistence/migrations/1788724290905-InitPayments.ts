import { MigrationInterface, QueryRunner } from "typeorm";

export class InitPayments1788724290905 implements MigrationInterface {
    name = 'InitPayments1788724290905'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() lives in uuid-ossp, which is not enabled by default.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(32) NOT NULL, "transaction_id" character varying(64) NOT NULL, "amount" bigint NOT NULL, "currency" character(3) NOT NULL, "source_wallet_reference" character varying(32) NOT NULL, "destination_wallet_reference" character varying(32) NOT NULL, "description" character varying(255) NOT NULL, "status" character varying(24) NOT NULL, "failure_reason" character varying(32), "debit_transaction_reference" character varying(32), "credit_transaction_reference" character varying(32), "refund_transaction_reference" character varying(32), "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_payments_reference" ON "payments" ("reference") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_payments_transaction_id" ON "payments" ("transaction_id") `);
        await queryRunner.query(`CREATE INDEX "ix_payments_source_wallet" ON "payments" ("source_wallet_reference") `);
        await queryRunner.query(`CREATE INDEX "ix_payments_status_updated" ON "payments" ("status", "updated_at") `);
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("key" character varying(64) NOT NULL, "request_hash" character(64) NOT NULL, "status" character varying(16) NOT NULL, "payment_reference" character varying(32), "response_body" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0afd83cbf08c9d12089a9bffc5e" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "aggregate_reference" character varying(32) NOT NULL, "event_type" character varying(64) NOT NULL, "payload" jsonb NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_340ab539f309f03bdaa14aa7649" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_outbox_aggregate" ON "outbox" ("aggregate_reference") `);
        await queryRunner.query(`CREATE INDEX "ix_outbox_unpublished" ON "outbox" ("published_at", "created_at") `);
        await queryRunner.query(`CREATE VIEW "payment_read_model" AS 
    SELECT p.reference,
           p.transaction_id,
           p.amount,
           p.currency,
           p.description,
           p.source_wallet_reference,
           p.destination_wallet_reference,
           p.status,
           p.failure_reason,
           p.debit_transaction_reference,
           p.credit_transaction_reference,
           p.refund_transaction_reference,
           p.created_at,
           p.completed_at
      FROM payments p
  `);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`, ["public","VIEW","payment_read_model","SELECT p.reference,\n           p.transaction_id,\n           p.amount,\n           p.currency,\n           p.description,\n           p.source_wallet_reference,\n           p.destination_wallet_reference,\n           p.status,\n           p.failure_reason,\n           p.debit_transaction_reference,\n           p.credit_transaction_reference,\n           p.refund_transaction_reference,\n           p.created_at,\n           p.completed_at\n      FROM payments p"]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`, ["VIEW","payment_read_model","public"]);
        await queryRunner.query(`DROP VIEW "payment_read_model"`);
        await queryRunner.query(`DROP INDEX "public"."ix_outbox_unpublished"`);
        await queryRunner.query(`DROP INDEX "public"."ix_outbox_aggregate"`);
        await queryRunner.query(`DROP TABLE "outbox"`);
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
        await queryRunner.query(`DROP INDEX "public"."ix_payments_status_updated"`);
        await queryRunner.query(`DROP INDEX "public"."ix_payments_source_wallet"`);
        await queryRunner.query(`DROP INDEX "public"."uq_payments_transaction_id"`);
        await queryRunner.query(`DROP INDEX "public"."uq_payments_reference"`);
        await queryRunner.query(`DROP TABLE "payments"`);
    }

}
