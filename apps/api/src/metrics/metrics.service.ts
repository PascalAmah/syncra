import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database';

interface SyncOpStatsRow {
  status: string;
  operation_type: string;
  count: string;
}

interface RecentOpRow {
  count: string;
}

@Injectable()
export class MetricsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Aggregates the user's sync operations into counts broken down by status
   * and operation type, plus success/failure rates and recent throughput.
   *
   * Latency is intentionally not reported: sync_operations only records a
   * created_at timestamp (no processed_at), so end-to-end processing latency
   * cannot be derived from persisted data.
   */
  async getSyncMetrics(userId: string) {
    const breakdown = await this.db.query<SyncOpStatsRow>(
      `SELECT status, operation_type, COUNT(*)::int AS count
       FROM sync_operations
       WHERE user_id = $1
       GROUP BY status, operation_type
       ORDER BY status, operation_type`,
      [userId]
    );

    const total = breakdown.rows.reduce((sum, r) => sum + Number(r.count), 0);

    const byStatus = breakdown.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + Number(r.count);
      return acc;
    }, {});

    const applied = byStatus['applied'] ?? 0;
    const rejected = byStatus['rejected'] ?? 0;
    const pending = byStatus['pending'] ?? 0;

    const lastHour = await this.db.query<RecentOpRow>(
      `SELECT COUNT(*)::int AS count
       FROM sync_operations
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'`,
      [userId]
    );

    // Breakdown of applied operations by type (creates/updates/deletes).
    const types = breakdown.rows
      .filter(r => r.status === 'applied')
      .reduce<Record<string, number>>((acc, r) => {
        acc[r.operation_type] = Number(r.count);
        return acc;
      }, {});

    return {
      operations: {
        total,
        applied,
        rejected,
        pending,
        successRate: total > 0 ? applied / total : 0,
        failureRate: total > 0 ? rejected / total : 0,
        throughputLastHour: Number(lastHour.rows[0]?.count ?? 0),
      },
      appliedByType: types,
    };
  }

  /**
   * Counts rejected (version-conflict) operations for the user, including a
   * breakdown by operation type. Rejected rows in sync_operations are recorded
   * whenever the server detects a version mismatch (see SyncService).
   */
  async getConflictMetrics(userId: string) {
    const totalRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count
       FROM sync_operations
       WHERE user_id = $1 AND status = 'rejected'`,
      [userId]
    );

    const byType = await this.db.query<SyncOpStatsRow>(
      `SELECT operation_type, COUNT(*)::int AS count
       FROM sync_operations
       WHERE user_id = $1 AND status = 'rejected'
       GROUP BY operation_type
       ORDER BY operation_type`,
      [userId]
    );

    const types = byType.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.operation_type] = Number(r.count);
      return acc;
    }, {});

    return {
      total: Number(totalRes.rows[0]?.count ?? 0),
      byOperationType: types,
      // The server only records one conflict outcome (version_conflict) for
      // rejected operations; client-side resolution (LWW vs custom handler)
      // is not persisted server-side.
      reasons:
        totalRes.rows[0] && Number(totalRes.rows[0].count) > 0
          ? { version_conflict: Number(totalRes.rows[0].count) }
          : {},
    };
  }
}
