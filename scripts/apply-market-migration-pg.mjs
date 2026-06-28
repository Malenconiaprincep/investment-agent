#!/usr/bin/env node
/**
 * 通过 Postgres 直连执行 market_users 迁移（需 SUPABASE_DB_URL）。
 * 在 Supabase Dashboard → Project Settings → Database → Connection string 获取。
 *
 * 用法：
 *   SUPABASE_DB_URL='postgresql://postgres.[ref]:[password]@...' node scripts/apply-market-migration-pg.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');

if (!dbUrl) {
  console.error('缺少 SUPABASE_DB_URL');
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    await client.query(sql);
    console.log('OK');
  }
  console.log(`Done. ${files.length} migration(s) applied.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end();
}
