import bcrypt from 'bcryptjs';
import type { AppPermission, AppRole } from './permissions';
import { isValidUsername } from './auth-session';
import { getSupabaseAdmin, isSupabaseConfigured } from './supabase-admin';

export type MarketUser = {
  id: string;
  username: string;
  label: string;
  role: AppRole;
  permissions: AppPermission[];
  presetTokens: boolean;
  plan: 'free' | 'pro' | 'enterprise';
  email: string | null;
  isActive: boolean;
};

type MarketUserRow = {
  id: string;
  username: string;
  password_hash: string;
  label: string;
  role: AppRole;
  permissions: string[] | null;
  preset_tokens: boolean;
  plan: 'free' | 'pro' | 'enterprise';
  email: string | null;
  is_active: boolean;
};

const VALID_PERMISSIONS = new Set<AppPermission>([
  'backtest',
  'admin',
  'screen',
  'research',
  'committee',
  'signals',
  'etf_pick',
]);

function normalizePermissions(values: string[] | null | undefined): AppPermission[] {
  if (!values?.length) return [];
  return values.filter((item): item is AppPermission =>
    VALID_PERMISSIONS.has(item as AppPermission),
  );
}

function mapRow(row: Omit<MarketUserRow, 'password_hash'>): MarketUser {
  return {
    id: row.id,
    username: row.username,
    label: row.label,
    role: row.role,
    permissions: normalizePermissions(row.permissions),
    presetTokens: row.preset_tokens,
    plan: row.plan,
    email: row.email,
    isActive: row.is_active,
  };
}

export function assertSupabaseAuthReady(): void {
  if (!isSupabaseConfigured()) {
    throw new Error('未配置 Supabase，无法注册或登录');
  }
}

export async function findMarketUserByUsername(
  username: string,
): Promise<(MarketUser & { passwordHash: string }) | null> {
  assertSupabaseAuthReady();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('market_users')
    .select(
      'id, username, password_hash, label, role, permissions, preset_tokens, plan, email, is_active',
    )
    .eq('username', username)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205') {
      throw new Error(
        'market_users 表不存在，请先在 Supabase SQL Editor 运行 supabase/migrations/ 下的迁移',
      );
    }
    throw new Error(error.message);
  }

  if (!data) return null;

  const row = data as MarketUserRow;
  return {
    ...mapRow(row),
    passwordHash: row.password_hash,
  };
}

export async function createMarketUser(input: {
  username: string;
  password: string;
  label?: string;
  email?: string | null;
}): Promise<MarketUser> {
  assertSupabaseAuthReady();

  if (!isValidUsername(input.username)) {
    throw new Error('账号仅支持 3–32 位字母、数字或下划线');
  }

  if (input.password.length < 8) {
    throw new Error('密码至少 8 位');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('market_users')
    .insert({
      username: input.username,
      password_hash: passwordHash,
      label: input.label?.trim() || input.username,
      email: input.email?.trim() || null,
      role: 'member',
      permissions: [],
      preset_tokens: false,
      plan: 'free',
      is_active: true,
    })
    .select(
      'id, username, label, role, permissions, preset_tokens, plan, email, is_active',
    )
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('该账号已被注册');
    }
    if (error.code === 'PGRST205') {
      throw new Error(
        'market_users 表不存在，请先在 Supabase SQL Editor 运行 supabase/migrations/ 下的迁移',
      );
    }
    throw new Error(error.message);
  }

  return mapRow(data as Omit<MarketUserRow, 'password_hash'>);
}

export async function verifyMarketUserPassword(
  username: string,
  password: string,
): Promise<MarketUser | null> {
  const user = await findMarketUserByUsername(username);
  if (!user || !user.isActive) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const { passwordHash: _, ...profile } = user;
  return profile;
}

export async function touchMarketUserLogin(username: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('market_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('username', username);
}
