import bcrypt from 'bcryptjs';
import type { AppPermission, AppRole } from './permissions';
import { isValidUsername } from './auth-session';
import {
  createDesktopUser,
  findDesktopUserByUsername,
  isDesktopAuthMode,
  listDesktopUsersPaginated as listDesktopUsersPaginatedImpl,
  resetDesktopUserPassword as resetDesktopUserPasswordImpl,
  touchDesktopUserLogin as touchDesktopUserLoginImpl,
  updateDesktopUser as updateDesktopUserImpl,
  verifyDesktopUserPassword,
} from './desktop-users';
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
  if (isDesktopAuthMode()) return;
  if (!isSupabaseConfigured()) {
    throw new Error('未配置 Supabase，无法注册或登录');
  }
}

export async function findMarketUserByUsername(
  username: string,
): Promise<(MarketUser & { passwordHash: string }) | null> {
  if (isDesktopAuthMode()) {
    return findDesktopUserByUsername(username);
  }
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
  if (isDesktopAuthMode()) {
    return createDesktopUser(input);
  }
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
  if (isDesktopAuthMode()) {
    return verifyDesktopUserPassword(username, password);
  }
  const user = await findMarketUserByUsername(username);
  if (!user || !user.isActive) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const { passwordHash: _, ...profile } = user;
  return profile;
}

export async function touchMarketUserLogin(username: string): Promise<void> {
  if (isDesktopAuthMode()) {
    return touchDesktopUserLoginImpl(username);
  }
  const supabase = getSupabaseAdmin();
  await supabase
    .from('market_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('username', username);
}

export type MarketUserAdminView = MarketUser & {
  createdAt: string | null;
  lastLoginAt: string | null;
};

type MarketUserListRow = Omit<MarketUserRow, 'password_hash'> & {
  created_at: string | null;
  last_login_at: string | null;
};

function mapListRow(row: MarketUserListRow): MarketUserAdminView {
  return {
    ...mapRow(row),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function listMarketUsers(): Promise<MarketUserAdminView[]> {
  const result = await listMarketUsersPaginated({ page: 1, pageSize: 1000 });
  return result.users;
}

export type MarketUsersPageResult = {
  users: MarketUserAdminView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function listMarketUsersPaginated(input: {
  page: number;
  pageSize: number;
}): Promise<MarketUsersPageResult> {
  if (isDesktopAuthMode()) {
    return listDesktopUsersPaginatedImpl(input);
  }
  assertSupabaseAuthReady();
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = getSupabaseAdmin();
  const { data, error, count } = await supabase
    .from('market_users')
    .select(
      'id, username, label, role, permissions, preset_tokens, plan, email, is_active, created_at, last_login_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error(error.message);
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    users: (data as MarketUserListRow[]).map(mapListRow),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function updateMarketUser(
  username: string,
  updates: {
    label?: string;
    role?: AppRole;
    plan?: MarketUser['plan'];
    permissions?: AppPermission[];
    isActive?: boolean;
  },
): Promise<MarketUserAdminView> {
  if (isDesktopAuthMode()) {
    return updateDesktopUserImpl(username, updates);
  }
  assertSupabaseAuthReady();

  const payload: Record<string, unknown> = {};
  if (updates.label !== undefined) payload.label = updates.label.trim();
  if (updates.role !== undefined) payload.role = updates.role;
  if (updates.plan !== undefined) payload.plan = updates.plan;
  if (updates.permissions !== undefined) {
    payload.permissions = updates.permissions;
  }
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('market_users')
    .update(payload)
    .eq('username', username)
    .select(
      'id, username, label, role, permissions, preset_tokens, plan, email, is_active, created_at, last_login_at',
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapListRow(data as MarketUserListRow);
}

export async function resetMarketUserPassword(
  username: string,
  newPassword: string,
): Promise<void> {
  if (isDesktopAuthMode()) {
    return resetDesktopUserPasswordImpl(username, newPassword);
  }
  assertSupabaseAuthReady();

  if (newPassword.length < 8) {
    throw new Error('新密码至少 8 位');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('market_users')
    .update({ password_hash: passwordHash })
    .eq('username', username);

  if (error) {
    throw new Error(error.message);
  }
}
