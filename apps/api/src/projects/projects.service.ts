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

  async createProject(userId: string, name: string): Promise<{ projectId: string; apiKey: string }> {
    const projectResult = await this.db.query<{ id: string }>(
      `INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id`,
      [userId, name],
    );
    const projectId = projectResult.rows[0].id;
    const apiKey = this.generateApiKey();

    await this.db.query(
      `INSERT INTO api_keys (project_id, key) VALUES ($1, $2)`,
      [projectId, apiKey],
    );

    return { projectId, apiKey };
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
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [userId],
    );

    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      apiKey: r.key,
    }));
  }

  async deleteProject(userId: string, projectId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, userId],
    );
  }

  async validateApiKey(key: string): Promise<{ projectId: string } | null> {
    const result = await this.db.query<{ project_id: string }>(
      `SELECT project_id FROM api_keys WHERE key = $1 LIMIT 1`,
      [key],
    );
    if (result.rows.length === 0) return null;
    return { projectId: result.rows[0].project_id };
  }
}
