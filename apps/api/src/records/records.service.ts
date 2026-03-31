import { Injectable } from '@nestjs/common';
import { SyncRecord } from '@syncra/core';
import { DatabaseService } from '../database';

@Injectable()
export class RecordsService {
  constructor(private readonly db: DatabaseService) {}

  async create(userId: string, data: Record<string, any>): Promise<SyncRecord> {
    const result = await this.db.query<SyncRecord>(
      `INSERT INTO records (user_id, data, version, updated_at, created_at)
       VALUES ($1, $2, 1, NOW(), NOW())
       RETURNING id, data, version, updated_at, created_at`,
      [userId, JSON.stringify(data)],
    );
    return result.rows[0];
  }

  async findAllByUser(userId: string): Promise<SyncRecord[]> {
    const result = await this.db.query<SyncRecord>(
      `SELECT id, data, version, updated_at, created_at FROM records WHERE user_id = $1`,
      [userId],
    );
    return result.rows;
  }
}
