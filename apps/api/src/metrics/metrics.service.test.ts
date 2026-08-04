/**
 * Unit tests for the MetricsService (Phase 7 — Observability backend).
 */
import { describe, it, expect, vi } from 'vitest';
import { MetricsService } from './metrics.service';

function makeDb(overrides: { rows: unknown[][] }) {
  const query = vi.fn();
  for (const rows of overrides.rows) {
    query.mockResolvedValueOnce({ rows });
  }
  return { query };
}

describe('MetricsService.getSyncMetrics', () => {
  it('aggregates operations by status and computes success/failure rates', async () => {
    const db = makeDb({
      rows: [
        // breakdown query
        [
          { status: 'applied', operation_type: 'create', count: 2 },
          { status: 'applied', operation_type: 'update', count: 1 },
          { status: 'rejected', operation_type: 'delete', count: 1 },
          { status: 'pending', operation_type: 'create', count: 1 },
        ],
        // lastHour query
        [{ count: 3 }],
      ],
    });

    const metrics = new MetricsService(db as any);
    const result = await metrics.getSyncMetrics('user-1');

    expect(result.operations.total).toBe(5);
    expect(result.operations.applied).toBe(3);
    expect(result.operations.rejected).toBe(1);
    expect(result.operations.pending).toBe(1);
    expect(result.operations.successRate).toBeCloseTo(0.6);
    expect(result.operations.failureRate).toBeCloseTo(0.2);
    expect(result.operations.throughputLastHour).toBe(3);
    expect(result.appliedByType).toEqual({ create: 2, update: 1 });

    // Both queries must be scoped to the user.
    expect(db.query.mock.calls[0][1]).toEqual(['user-1']);
    expect(db.query.mock.calls[1][1]).toEqual(['user-1']);
  });

  it('returns zeroed rates when there are no operations', async () => {
    const db = makeDb({ rows: [[], [{ count: 0 }]] });
    const metrics = new MetricsService(db as any);

    const result = await metrics.getSyncMetrics('user-1');

    expect(result.operations.total).toBe(0);
    expect(result.operations.successRate).toBe(0);
    expect(result.operations.failureRate).toBe(0);
    expect(result.appliedByType).toEqual({});
  });
});

describe('MetricsService.getConflictMetrics', () => {
  it('counts rejected operations by operation type', async () => {
    const db = makeDb({
      rows: [
        [{ count: 2 }], // total rejected
        [
          { operation_type: 'update', count: 1 },
          { operation_type: 'delete', count: 1 },
        ],
      ],
    });

    const metrics = new MetricsService(db as any);
    const result = await metrics.getConflictMetrics('user-1');

    expect(result.total).toBe(2);
    expect(result.byOperationType).toEqual({ update: 1, delete: 1 });
    expect(result.reasons).toEqual({ version_conflict: 2 });

    expect(db.query.mock.calls[0][1]).toEqual(['user-1']);
    expect(db.query.mock.calls[1][1]).toEqual(['user-1']);
  });

  it('returns empty breakdowns when no conflicts exist', async () => {
    const db = makeDb({ rows: [[{ count: 0 }], []] });
    const metrics = new MetricsService(db as any);

    const result = await metrics.getConflictMetrics('user-1');

    expect(result.total).toBe(0);
    expect(result.byOperationType).toEqual({});
    expect(result.reasons).toEqual({});
  });
});
