import { createClient, type Client } from '@libsql/client';
import { getPrimaryLibsqlOptions } from '../libsql-config.js';

export type FeedbackTargetType = 'report' | 'screening';

export type FeedbackRecord = {
  id: string;
  targetType: FeedbackTargetType;
  targetId: string;
  rating: 1 | -1;
  comment: string | null;
  createdAt: string;
};

let client: Client | null = null;
let migrated = false;

async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }

  if (!migrated) {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS user_feedback (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_user_feedback_target
        ON user_feedback(target_type, target_id)
    `);
    migrated = true;
  }

  return client;
}

export async function saveFeedback(input: {
  targetType: FeedbackTargetType;
  targetId: string;
  rating: 1 | -1;
  comment?: string;
}): Promise<FeedbackRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO user_feedback (id, target_type, target_id, rating, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.targetType,
      input.targetId,
      input.rating,
      input.comment ?? null,
      createdAt,
    ],
  });

  return {
    id,
    targetType: input.targetType,
    targetId: input.targetId,
    rating: input.rating,
    comment: input.comment ?? null,
    createdAt,
  };
}

export async function getFeedbackSummary(
  targetType: FeedbackTargetType,
  targetId: string,
): Promise<{ up: number; down: number; latest: FeedbackRecord | null }> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM user_feedback
          WHERE target_type = ? AND target_id = ?
          ORDER BY created_at DESC`,
    args: [targetType, targetId],
  });

  const rows = result.rows as Record<string, unknown>[];
  let up = 0;
  let down = 0;
  let latest: FeedbackRecord | null = null;

  for (const row of rows) {
    const rating = Number(row.rating);
    if (rating > 0) up += 1;
    else down += 1;
    if (!latest) {
      latest = {
        id: String(row.id),
        targetType: row.target_type as FeedbackTargetType,
        targetId: String(row.target_id),
        rating: rating > 0 ? 1 : -1,
        comment: row.comment == null ? null : String(row.comment),
        createdAt: String(row.created_at),
      };
    }
  }

  return { up, down, latest };
}

export async function listRecentFeedback(limit = 20): Promise<FeedbackRecord[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const rating = Number(r.rating);
    return {
      id: String(r.id),
      targetType: r.target_type as FeedbackTargetType,
      targetId: String(r.target_id),
      rating: rating > 0 ? 1 : -1,
      comment: r.comment == null ? null : String(r.comment),
      createdAt: String(r.created_at),
    };
  });
}
