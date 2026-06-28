#!/usr/bin/env node
/**
 * 写入/更新 adminwb、test 默认账号到 market_users。
 * 需要 apps/web/.env.local 或 packages/agent-core/.env 中的 Supabase 配置。
 *
 * 用法：node scripts/seed-market-users.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

dotenv.config({ path: path.join(root, 'apps/web/.env.local') });
dotenv.config({ path: path.join(root, 'packages/agent-core/.env') });

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const users = [
    {
      username: 'adminwb',
      password_hash: await bcrypt.hash('Wb@Invest2026!xK9', 12),
      label: '管理员',
      role: 'admin',
      permissions: ['backtest', 'admin'],
      preset_tokens: true,
      plan: 'pro',
      is_active: true,
    },
    {
      username: 'test',
      password_hash: await bcrypt.hash('test123456', 12),
      label: '测试账号',
      role: 'member',
      permissions: [],
      preset_tokens: false,
      plan: 'free',
      is_active: true,
    },
  ];

  for (const user of users) {
    const { error } = await sb.from('market_users').upsert(user, {
      onConflict: 'username',
    });
    if (error) {
      console.error(user.username, error.message);
      process.exit(1);
    }
    console.log(`OK ${user.username}`);
  }

  console.log('Seed complete. adminwb / test ready.');
}

void main();
