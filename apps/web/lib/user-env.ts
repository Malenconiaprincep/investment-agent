import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { patchAgentCoreEnvKeys } from './agent-core';
import type { AppUserId } from './users';
import { getAppUser, isAppUserId } from './users';

export const TOKEN_KEYS = [
  'DEEPSEEK_API_KEY',
  'IWENCAI_API_KEY',
  'IWENCAI_BASE_URL',
  'LIBSQL_URL',
  'LIBSQL_AUTH_TOKEN',
  'AGENT_CORE_TOKEN',
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

export type TokenConfigStatus = {
  username: AppUserId;
  userLabel: string;
  presetTokens: boolean;
  envPath: string;
  keys: Record<TokenKey, { configured: boolean; masked?: string }>;
  restartRequired: boolean;
};

function resolveDataDir(): string {
  const fromEnv = process.env.INVESTMENT_AGENT_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), '.data');
}

export function getUserEnvPath(username: AppUserId): string {
  return path.join(resolveDataDir(), 'users', username, '.env');
}

export function getActiveEnvPath(): string {
  const explicit =
    process.env.INVESTMENT_AGENT_ENV_PATH?.trim() ||
    process.env.DOTENV_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  return path.join(resolveDataDir(), 'active.env');
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function parseEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  return dotenv.parse(readFileSync(envPath));
}

function serializeEnvFile(values: Record<string, string>): string {
  const lines = ['# 投研助手 Token 配置', ''];
  for (const key of TOKEN_KEYS) {
    const value = values[key]?.trim();
    if (value) lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n').trim()}\n`;
}

function writeEnvFile(envPath: string, values: Record<string, string>) {
  mkdirSync(path.dirname(envPath), { recursive: true });
  writeFileSync(envPath, serializeEnvFile(values), 'utf-8');
}

function resolveAdminDefaultsPaths(): string[] {
  const paths: string[] = [];
  const resourcesPath = process.env.INVESTMENT_AGENT_RESOURCES_PATH?.trim();
  if (resourcesPath) {
    paths.push(path.join(resourcesPath, 'templates', 'admin-defaults.env'));
  }
  paths.push(
    path.join(process.cwd(), 'templates', 'admin-defaults.env'),
    path.join(process.cwd(), '..', 'desktop', 'templates', 'admin-defaults.env'),
    path.join(process.cwd(), '..', '..', 'apps', 'desktop', 'templates', 'admin-defaults.env'),
  );

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    paths.push(path.join(dir, 'packages', 'agent-core', '.env'));
    paths.push(path.join(dir, 'apps', 'desktop', 'templates', 'admin-defaults.env'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return paths;
}

function loadAdminDefaultTokens(): Record<string, string> {
  for (const candidate of resolveAdminDefaultsPaths()) {
    if (!existsSync(candidate)) continue;
    const parsed = parseEnvFile(candidate);
    const picked: Record<string, string> = {};
    for (const key of TOKEN_KEYS) {
      if (parsed[key]?.trim()) picked[key] = parsed[key].trim();
    }
    if (Object.keys(picked).length > 0) return picked;
  }
  return {};
}

export function ensureUserEnvSeeded(username: AppUserId): Record<string, string> {
  const userPath = getUserEnvPath(username);
  if (existsSync(userPath)) {
    return parseEnvFile(userPath);
  }

  const user = getAppUser(username);
  const initial = user.presetTokens ? loadAdminDefaultTokens() : {};
  writeEnvFile(userPath, initial);
  return initial;
}

function readUserEnv(username: AppUserId): Record<string, string> {
  return parseEnvFile(getUserEnvPath(username));
}

function writeUserEnv(username: AppUserId, values: Record<string, string>) {
  writeEnvFile(getUserEnvPath(username), values);
}

function writeActiveEnv(values: Record<string, string>) {
  writeEnvFile(getActiveEnvPath(), values);
}

async function syncTokensToAgentCore(values: Record<string, string>) {
  const updates: Record<string, string | null> = {};
  for (const key of TOKEN_KEYS) {
    updates[key] = values[key]?.trim() || null;
  }
  await patchAgentCoreEnvKeys(updates);
}

export async function activateUserEnv(username: AppUserId): Promise<void> {
  const values = ensureUserEnvSeeded(username);
  writeActiveEnv(values);
  await syncTokensToAgentCore(values);
}

export function getTokenConfigStatus(username: AppUserId): TokenConfigStatus {
  const user = getAppUser(username);
  const values = ensureUserEnvSeeded(username);
  const keys = {} as TokenConfigStatus['keys'];

  for (const key of TOKEN_KEYS) {
    const value = values[key]?.trim() ?? '';
    keys[key] = value
      ? { configured: true, masked: maskSecret(value) }
      : { configured: false };
  }

  return {
    username,
    userLabel: user.label,
    presetTokens: user.presetTokens,
    envPath: getUserEnvPath(username),
    keys,
    restartRequired: false,
  };
}

export async function updateUserTokenConfig(
  username: AppUserId,
  updates: Partial<Record<TokenKey, string | null>>,
): Promise<TokenConfigStatus> {
  const current = ensureUserEnvSeeded(username);

  for (const key of TOKEN_KEYS) {
    if (!(key in updates)) continue;
    const next = updates[key];
    if (next === null || next === undefined || !next.trim()) {
      delete current[key];
      continue;
    }
    current[key] = next.trim();
  }

  writeUserEnv(username, current);
  writeActiveEnv(current);
  await syncTokensToAgentCore(current);

  return {
    ...getTokenConfigStatus(username),
    restartRequired: false,
  };
}

export function assertAppUser(username: string): AppUserId {
  if (!isAppUserId(username)) {
    throw new Error('无效的用户');
  }
  return username;
}
