import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectsService } from './projects.service';

function makeDb() {
  const client = { query: vi.fn(), release: vi.fn() };
  return {
    query: vi.fn(),
    getClient: vi.fn().mockResolvedValue(client),
    client,
  } as any;
}

describe('ProjectsService', () => {
  let db: ReturnType<typeof makeDb>;
  let service: ProjectsService;

  beforeEach(() => {
    db = makeDb();
    service = new ProjectsService(db);
  });

  describe('rotateApiKey', () => {
    it('returns null when the project does not belong to the user', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const result = await service.rotateApiKey('user-1', 'project-1');
      expect(result).toBeNull();
    });

    it('revokes the old key and creates a new one atomically', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'project-1' }] });

      const result = await service.rotateApiKey('user-1', 'project-1');

      expect(result).not.toBeNull();
      expect(result!.apiKey).toMatch(/^syncra_pk_live_[0-9a-f]{48}$/);

      // A transaction was begun and committed.
      expect(db.client.query).toHaveBeenCalledWith('BEGIN');
      expect(db.client.query).toHaveBeenCalledWith('COMMIT');
      expect(db.client.release).toHaveBeenCalled();

      const updateCall = db.client.query.mock.calls.find(([sql]: [string]) =>
        sql.includes('UPDATE api_keys')
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall![0]).toContain('active = FALSE');

      const insertCall = db.client.query.mock.calls.find(([sql]: [string]) =>
        sql.includes('INSERT INTO api_keys')
      );
      expect(insertCall).toBeTruthy();
    });

    it('rolls back the transaction on error and rethrows', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'project-1' }] });
      db.client.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        throw new Error('boom');
      });

      await expect(service.rotateApiKey('user-1', 'project-1')).rejects.toThrow('boom');
      expect(db.client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(db.client.release).toHaveBeenCalled();
    });
  });

  describe('validateApiKey', () => {
    it('only accepts active keys', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ project_id: 'p', user_id: 'u' }] });
      const result = await service.validateApiKey('some-key');
      expect(result).toEqual({ projectId: 'p', userId: 'u' });
      const sql = db.query.mock.calls[0][0] as string;
      expect(sql).toContain('ak.active = TRUE');
    });

    it('returns null for an unknown key', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      expect(await service.validateApiKey('nope')).toBeNull();
    });
  });
});
