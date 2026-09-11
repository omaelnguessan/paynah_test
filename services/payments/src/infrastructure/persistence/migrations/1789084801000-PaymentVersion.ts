import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentVersion1789084801000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE payments ADD COLUMN version integer NOT NULL DEFAULT 1');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE payments DROP COLUMN version');
  }
}
