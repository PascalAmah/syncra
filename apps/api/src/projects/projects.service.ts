import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../database';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  apiKey: string;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  private generateApiKey(): string {
    const hex = crypto.randomBytes(24).toString('hex');
    return `syncra_pk_live_${hex}`;
  }

  async createProject(
    userId: string,
    name: string
  ): Promise<{ projectId: string; apiKey: string }> {
    const projectResult = await this.db.query<{ id: string }>(
      `INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id`,
      [userId, name]
    );
    const projectId = projectResult.rows[0].id;
    const apiKey = this.generateApiKey();

    await this.db.query(`INSERT INTO api_keys (project_id, key) VALUES ($1, $2)`, [
      projectId,
      apiKey,
    ]);

    return { projectId, apiKey };
  }

  /**
   * Rotates the API key for a project owned by `userId`.
   *
   * Issues a fresh active key and instantly revokes the previously active key
   * so a leaked key stops authenticating as soon as rotation happens. The new
   * key is returned exactly once (it cannot be recovered afterwards).
   */
  async rotateApiKey(
    userId: string,
    projectId: string
  ): Promise<{ projectId: string; apiKey: string } | null> {
    const project = await this.db.query<{ id: string }>(
      `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    if (project.rows.length === 0) return null;

    const newKey = this.generateApiKey();

    // Atomically revoke the old active key and insert the new one so there is
    // no window where a project has zero or two active keys.
    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE api_keys SET active = FALSE, revoked_at = CURRENT_TIMESTAMP
         WHERE project_id = $1 AND active = TRUE`,
        [projectId]
      );
      await client.query(`INSERT INTO api_keys (project_id, key) VALUES ($1, $2)`, [
        projectId,
        newKey,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { projectId, apiKey: newKey };
  }

  async getUserProjects(userId: string): Promise<Project[]> {
    const result = await this.db.query<{
      id: string;
      name: string;
      created_at: string;
      key: string;
    }>(
      `SELECT p.id, p.name, p.created_at, ak.key
       FROM projects p
       JOIN api_keys ak ON ak.project_id = p.id
       WHERE p.user_id = $1 AND ak.active = TRUE
       ORDER BY p.created_at DESC`,
      [userId]
    );

    return result.rows.map((r: { id: string; name: string; created_at: string; key: string }) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      apiKey: r.key,
    }));
  }

  async deleteProject(userId: string, projectId: string): Promise<void> {
    await this.db.query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
  }

  /**
   * Resolves an API key to the owning project and the user that owns it.
   * The owning user is authoritative: request handlers must scope all data
   * access to this user id and must NOT trust any client-supplied identity
   * (e.g. an x-user-id header), otherwise any API-key holder could
   * impersonate an arbitrary user (security fix).
   */
  async validateApiKey(key: string): Promise<{ projectId: string; userId: string } | null> {
    const result = await this.db.query<{ project_id: string; user_id: string }>(
      `SELECT ak.project_id, p.user_id
       FROM api_keys ak
       JOIN projects p ON p.id = ak.project_id
       WHERE ak.key = $1 AND ak.active = TRUE
       LIMIT 1`,
      [key]
    );
    if (result.rows.length === 0) return null;
    return { projectId: result.rows[0].project_id, userId: result.rows[0].user_id };
  }
}
