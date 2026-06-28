#!/usr/bin/env node
/**
 * 通过 Supabase Management API 应用 supabase/migrations 下的 SQL。
 * 需要环境变量 SUPABASE_ACCESS_TOKEN（Dashboard → Account → Access Tokens）
 *
 * 用法：
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-supabase-migration.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-supabase-migration.mjs market_create_users
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'jixkzyrresmceaekjian';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const filter = process.argv[2]?.trim();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');

if (!TOKEN) {
  console.error('缺少 SUPABASE_ACCESS_TOKEN');
  console.error('在 https://supabase.com/dashboard/account/tokens 创建后重试');
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => !filter || f.includes(filter));

if (files.length === 0) {
  console.error('未找到匹配的 migration 文件');
  process.exit(1);
}

async function runQuery(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return body;
}

for (const file of files) {
  const query = readFileSync(path.join(migrationsDir, file), 'utf8');
  const name = file.replace(/\.sql$/, '');
  process.stdout.write(`Applying ${file} ... `);
  try {
    await runQuery(query);
    console.log('OK');
  } catch (err) {
    console.log('FAILED');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

console.log(`Done. ${files.length} migration(s) applied.`);
