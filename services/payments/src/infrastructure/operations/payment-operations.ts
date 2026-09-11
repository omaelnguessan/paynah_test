import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { OUTBOX_MAX_ATTEMPTS } from '../messaging/outbox.constants';

@Injectable()
export class PaymentOperations {
  private readonly logger = new Logger(PaymentOperations.name);
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async metrics(): Promise<Record<string, number>> {
    const [row] = await this.database.query(
      `SELECT
      (SELECT count(*)::int FROM outbox WHERE published_at IS NULL) AS outbox_pending,
      (SELECT count(*)::int FROM outbox WHERE published_at IS NULL AND attempts >= $1) AS outbox_exhausted,
      (SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0)::float FROM outbox WHERE published_at IS NULL) AS oldest_unpublished_seconds,
      (SELECT count(*)::int FROM payments WHERE status IN ('Pending', 'Processing', 'CompensationPending') AND updated_at < now() - interval '5 minutes') AS payments_stuck,
      (SELECT count(*)::int FROM payments WHERE status = 'CompensationPending') AS compensations_pending,
      (SELECT count(*)::int FROM payments WHERE reconciliation_attempts >= 10 AND status IN ('Pending', 'Processing', 'CompensationPending')) AS reconciliation_attention`,
      [OUTBOX_MAX_ATTEMPTS],
    );
    return row;
  }

  async retryOutbox(id: string): Promise<boolean> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Expected an outbox UUID');
    }
    // Retain message identity and payload. Never replay an acknowledged row.
    const rows = await this.database.query(
      `UPDATE outbox SET attempts = 0,
      last_error = NULL, next_attempt_at = now()
      WHERE id = $1 AND published_at IS NULL AND attempts >= $2 RETURNING id`,
      [id, OUTBOX_MAX_ATTEMPTS],
    );
    // TypeORM's postgres UPDATE result is [returnedRows, affectedCount].
    return rows[1] === 1;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'payment-operational-metrics' })
  async report(): Promise<void> {
    try {
      const metrics = await this.metrics();
      this.logger.log(metrics, 'payment operational metrics');
      if (metrics.outbox_exhausted || metrics.reconciliation_attention) {
        this.logger.error(metrics, 'PAYMENT OPERATIONS NEED ATTENTION');
      }
    } catch (error) {
      this.logger.error(
        { cause: error instanceof Error ? error.message : String(error) },
        'metrics unavailable',
      );
    }
  }
}
