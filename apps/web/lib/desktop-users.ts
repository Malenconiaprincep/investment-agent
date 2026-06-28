import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { AppPermission, AppRole } from './permissions';
import { isValidUsername } from './auth-session';

export type DesktopMarketUser = {
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

export type DesktopMarketUserAdminView = DesktopMarketUser & {
  createdAt: string | null;
  lastLoginAt: string | null;
};

export type DesktopMarketUsersPageResult = {
  users: DesktopMarketUserAdminView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type DesktopUserRow = {
  id: string;
  username: string;
  password_hash: string;
  label: string;
  role: AppRole;
  permissions: AppPermission[];
  preset_tokens: boolean;
  plan: 'free' | 'pro' | 'enterprise';
  email: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

type DesktopUserStore = {
  users: DesktopUserRow[];
};

/** 与 supabase/migrations/20250628120001_market_seed_users.sql 保持一致 */
const DEFAULT_USERS: Omit<DesktopUserRow, 'id' | 'created_at' | 'last_login_at'>[] = [
  {
    username: 'adminwb',
    password_hash:
      '$2b$12$ZRXr4cZQOwFId5BJRCz9MuXh6qDF0oTCkEiEdKbRWtIVWgXsS0u36',
    label: '管理员',
    role: 'admin',
    permissions: ['backtest', 'admin'],
    preset_tokens: true,
    plan: 'pro',
    email: null,
    is_active: true,
  },
  {
    username: 'test',
    password_hash:
      '$2b$12$/KhN.Tgh.Y.zWrAAe./lQOgSbGZzOQesOLEG3YDEX4Q.7gQGtz5LK',
    label: '测试账号',
    role: 'member',
    permissions: [],
    preset_tokens: false,
    plan: 'free',
    email: null,
    is_active: true,
  },
];

function resolveStorePath(): string {
  const dataDir =
    process.env.INVESTMENT_AGENT_DATA_DIR?.trim() ||
    path.join(process.cwd(), '.data');
  return path.join(dataDir, 'users.json');
}

function mapRow(row: DesktopUserRow): DesktopMarketUser {
  return {
    id: row.id,
    username: row.username,
    label: row.label,
    role: row.role,
    permissions: row.permissions,
    presetTokens: row.preset_tokens,
    plan: row.plan,
    email: row.email,
    isActive: row.is_active,
  };
}

function mapListRow(row: DesktopUserRow): DesktopMarketUserAdminView {
  return {
    ...mapRow(row),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function seedDefaults(): DesktopUserStore {
  const now = new Date().toISOString();
  return {
    users: DEFAULT_USERS.map((user) => ({
      ...user,
      id: randomUUID(),
      created_at: now,
      last_login_at: null,
    })),
  };
}

function readStore(): DesktopUserStore {
  const storePath = resolveStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });

  if (!existsSync(storePath)) {
    const seeded = seedDefaults();
    writeFileSync(storePath, JSON.stringify(seeded, null, 2), 'utf-8');
    return seeded;
  }

  const parsed = JSON.parse(readFileSync(storePath, 'utf-8')) as DesktopUserStore;
  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    const seeded = seedDefaults();
    writeFileSync(storePath, JSON.stringify(seeded, null, 2), 'utf-8');
    return seeded;
  }

  return parsed;
}

function writeStore(store: DesktopUserStore): void {
  const storePath = resolveStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
}

function findRow(
  store: DesktopUserStore,
  username: string,
): DesktopUserRow | undefined {
  return store.users.find((user) => user.username === username);
}

export function isDesktopAuthMode(): boolean {
  return process.env.INVESTMENT_AGENT_DESKTOP === '1';
}

export async function findDesktopUserByUsername(
  username: string,
): Promise<(DesktopMarketUser & { passwordHash: string }) | null> {
  const store = readStore();
  const row = findRow(store, username);
  if (!row) return null;

  return {
    ...mapRow(row),
    passwordHash: row.password_hash,
  };
}

export async function verifyDesktopUserPassword(
  username: string,
  password: string,
): Promise<DesktopMarketUser | null> {
  const user = await findDesktopUserByUsername(username);
  if (!user || !user.isActive) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const { passwordHash: _, ...profile } = user;
  return profile;
}

export async function createDesktopUser(input: {
  username: string;
  password: string;
  label?: string;
  email?: string | null;
}): Promise<DesktopMarketUser> {
  if (!isValidUsername(input.username)) {
    throw new Error('账号仅支持 3–32 位字母、数字或下划线');
  }

  if (input.password.length < 8) {
    throw new Error('密码至少 8 位');
  }

  const store = readStore();
  if (findRow(store, input.username)) {
    throw new Error('该账号已被注册');
  }

  const row: DesktopUserRow = {
    id: randomUUID(),
    username: input.username,
    password_hash: await bcrypt.hash(input.password, 12),
    label: input.label?.trim() || input.username,
    email: input.email?.trim() || null,
    role: 'member',
    permissions: [],
    preset_tokens: false,
    plan: 'free',
    is_active: true,
    created_at: new Date().toISOString(),
    last_login_at: null,
  };

  store.users.push(row);
  writeStore(store);
  return mapRow(row);
}

export async function touchDesktopUserLogin(username: string): Promise<void> {
  const store = readStore();
  const row = findRow(store, username);
  if (!row) return;

  row.last_login_at = new Date().toISOString();
  writeStore(store);
}

export async function listDesktopUsersPaginated(input: {
  page: number;
  pageSize: number;
}): Promise<DesktopMarketUsersPageResult> {
  const store = readStore();
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const sorted = [...store.users].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize;
  const users = sorted.slice(from, from + pageSize).map(mapListRow);

  return { users, total, page, pageSize, totalPages };
}

export async function updateDesktopUser(
  username: string,
  updates: {
    label?: string;
    role?: AppRole;
    plan?: DesktopMarketUser['plan'];
    permissions?: AppPermission[];
    isActive?: boolean;
  },
): Promise<DesktopMarketUserAdminView> {
  const store = readStore();
  const row = findRow(store, username);
  if (!row) {
    throw new Error('用户不存在');
  }

  if (updates.label !== undefined) row.label = updates.label.trim();
  if (updates.role !== undefined) row.role = updates.role;
  if (updates.plan !== undefined) row.plan = updates.plan;
  if (updates.permissions !== undefined) row.permissions = updates.permissions;
  if (updates.isActive !== undefined) row.is_active = updates.isActive;

  writeStore(store);
  return mapListRow(row);
}

export async function resetDesktopUserPassword(
  username: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) {
    throw new Error('新密码至少 8 位');
  }

  const store = readStore();
  const row = findRow(store, username);
  if (!row) {
    throw new Error('用户不存在');
  }

  row.password_hash = await bcrypt.hash(newPassword, 12);
  writeStore(store);
}
