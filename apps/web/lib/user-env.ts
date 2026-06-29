import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { isValidUsername } from './auth-session';
import { patchAgentCoreEnvKeys } from './agent-core';
import {
  AI_API_KEY_ENVS,
  AI_MODEL_ENV,
  DEFAULT_MODEL_ID,
  getApiKeyEnvForModel,
} from './model-providers';

export const TOKEN_KEYS = [
  AI_MODEL_ENV,
  ...AI_API_KEY_ENVS,
  'IWENCAI_API_KEY',
  'IWENCAI_BASE_URL',
] as const;

import {
  FEISHU_NOTIFY_KEYS,
  FEISHU_TOGGLE_KEYS,
  type FeishuNotifyKey,
  type FeishuToggleKey,
} from './feishu-settings';

export const PACKAGED_ENV_KEYS = ['IWENCAI_BASE_URL'] as const;

export type PackagedEnvKey = (typeof PACKAGED_ENV_KEYS)[number];

export const DEFAULT_IWENCAI_BASE_URL = 'https://openapi.iwencai.com';

export type TokenKey = (typeof TOKEN_KEYS)[number];
export const SYNCED_ENV_KEYS = [
  ...TOKEN_KEYS,
  ...FEISHU_NOTIFY_KEYS,
  ...FEISHU_TOGGLE_KEYS,
] as const;
export type SyncedEnvKey = (typeof SYNCED_ENV_KEYS)[number];

export { FEISHU_NOTIFY_KEYS, FEISHU_TOGGLE_KEYS };
export type { FeishuNotifyKey, FeishuToggleKey };

export type FeishuConfigStatus = {
  configured: boolean;
  mode: 'app' | 'webhook' | null;
  notifyEnabled: boolean;
  etfMonitorPushAll: boolean;
  monitorRealtime: boolean;
  stockIntraday: boolean;
};

export type TokenKeyStatus = {
  configured: boolean;
  masked?: string;
  value?: string;
};

export type TokenConfigStatus = {
  username: string;
  userLabel: string;
  presetTokens: boolean;
  envPath: string;
  aiModel: string;
  requiredApiKeyEnv: string;
  keys: Record<SyncedEnvKey, TokenKeyStatus>;
  feishu: FeishuConfigStatus;
  restartRequired: boolean;
};

function resolveDataDir(): string {
  const fromEnv = process.env.INVESTMENT_AGENT_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), '.data');
}

export function getUserEnvPath(username: string): string {
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

  const aiModel = values[AI_MODEL_ENV]?.trim();
  if (aiModel) {
    lines.push(`# AI 模型`);
    lines.push(`${AI_MODEL_ENV}=${aiModel}`);
    lines.push('');
  }

  const configuredAiKeys = AI_API_KEY_ENVS.filter((key) => values[key]?.trim());
  if (configuredAiKeys.length > 0) {
    lines.push('# AI 提供商 API Key');
    for (const key of AI_API_KEY_ENVS) {
      const value = values[key]?.trim();
      if (value) lines.push(`${key}=${value}`);
    }
    lines.push('');
  }

  const otherKeys = TOKEN_KEYS.filter(
    (key) =>
      key !== AI_MODEL_ENV &&
      !(AI_API_KEY_ENVS as readonly string[]).includes(key),
  );
  for (const key of otherKeys) {
    const value = values[key]?.trim();
    if (value) lines.push(`${key}=${value}`);
  }

  const feishuKeys = FEISHU_NOTIFY_KEYS.filter((key) => values[key]?.trim());
  if (feishuKeys.length > 0) {
    lines.push('', '# 飞书推送');
    for (const key of FEISHU_NOTIFY_KEYS) {
      const value = values[key]?.trim();
      if (value) lines.push(`${key}=${value}`);
    }
  }

  const toggleKeys = FEISHU_TOGGLE_KEYS.filter((key) => values[key]?.trim());
  if (toggleKeys.length > 0) {
    lines.push('', '# 飞书推送开关');
    for (const key of FEISHU_TOGGLE_KEYS) {
      const value = values[key]?.trim();
      if (value) lines.push(`${key}=${value}`);
    }
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

function loadPackagedDefaults(): Record<string, string> {
  const defaults: Record<string, string> = {
    IWENCAI_BASE_URL: DEFAULT_IWENCAI_BASE_URL,
  };

  for (const candidate of resolveAdminDefaultsPaths()) {
    if (!existsSync(candidate)) continue;
    const parsed = parseEnvFile(candidate);
    const baseUrl = parsed.IWENCAI_BASE_URL?.trim();
    if (baseUrl) {
      defaults.IWENCAI_BASE_URL = baseUrl;
      return defaults;
    }
  }

  return defaults;
}

function applyPackagedDefaults(values: Record<string, string>): boolean {
  const defaults = loadPackagedDefaults();
  let changed = false;
  for (const key of PACKAGED_ENV_KEYS) {
    if (!values[key]?.trim() && defaults[key]?.trim()) {
      values[key] = defaults[key].trim();
      changed = true;
    }
  }
  return changed;
}

export function ensureUserEnvSeeded(
  username: string,
  presetTokens: boolean,
): Record<string, string> {
  const userPath = getUserEnvPath(username);
  if (existsSync(userPath)) {
    return parseEnvFile(userPath);
  }

  const initial = loadPackagedDefaults();
  writeEnvFile(userPath, initial);
  return initial;
}

function writeUserEnv(username: string, values: Record<string, string>) {
  writeEnvFile(getUserEnvPath(username), values);
}

function writeActiveEnv(values: Record<string, string>) {
  writeEnvFile(getActiveEnvPath(), values);
}

async function syncTokensToAgentCore(values: Record<string, string>) {
  const updates: Record<string, string | null> = {};
  for (const key of SYNCED_ENV_KEYS) {
    updates[key] = values[key]?.trim() || null;
  }
  await patchAgentCoreEnvKeys(updates);
}

export async function activateUserEnv(
  username: string,
  presetTokens: boolean,
): Promise<void> {
  const values = ensureUserEnvSeeded(username, presetTokens);
  if (applyPackagedDefaults(values)) {
    writeUserEnv(username, values);
  }
  writeActiveEnv(values);
  await syncTokensToAgentCore(values);
}

function buildKeyStatus(key: SyncedEnvKey, value: string): TokenKeyStatus {
  const trimmed = value.trim();
  if (key === AI_MODEL_ENV) {
    return trimmed
      ? { configured: true, value: trimmed }
      : { configured: false };
  }
  if ((FEISHU_TOGGLE_KEYS as readonly string[]).includes(key)) {
    const effective = resolveFeishuToggleValue(key as FeishuToggleKey, trimmed);
    return {
      configured: effective === '1',
      value: effective,
    };
  }
  if (!trimmed) return { configured: false };
  if (key === 'IWENCAI_BASE_URL') {
    return { configured: true, value: trimmed };
  }
  return { configured: true, masked: maskSecret(trimmed) };
}

const FEISHU_TOGGLE_DEFAULTS: Record<FeishuToggleKey, '0' | '1'> = {
  FEISHU_NOTIFY_ENABLED: '1',
  FEISHU_NOTIFY_ETF_MONITOR: '0',
  FEISHU_NOTIFY_MONITOR: '1',
  FEISHU_NOTIFY_STOCK_INTRADAY: '1',
};

function resolveFeishuToggleValue(
  key: FeishuToggleKey,
  value: string,
): '0' | '1' {
  if (value === '0' || value === '1') return value;
  return FEISHU_TOGGLE_DEFAULTS[key];
}

export function getFeishuConfigStatus(
  values: Record<string, string>,
): FeishuConfigStatus {
  const appId = values.FEISHU_APP_ID?.trim();
  const appSecret = values.FEISHU_APP_SECRET?.trim();
  const webhook = values.FEISHU_WEBHOOK_URL?.trim();
  const mode =
    appId && appSecret ? 'app' : webhook ? 'webhook' : null;

  return {
    configured: mode != null,
    mode,
    notifyEnabled:
      resolveFeishuToggleValue(
        'FEISHU_NOTIFY_ENABLED',
        values.FEISHU_NOTIFY_ENABLED?.trim() ?? '',
      ) === '1',
    etfMonitorPushAll:
      resolveFeishuToggleValue(
        'FEISHU_NOTIFY_ETF_MONITOR',
        values.FEISHU_NOTIFY_ETF_MONITOR?.trim() ?? '',
      ) === '1',
    monitorRealtime:
      resolveFeishuToggleValue(
        'FEISHU_NOTIFY_MONITOR',
        values.FEISHU_NOTIFY_MONITOR?.trim() ?? '',
      ) === '1',
    stockIntraday:
      resolveFeishuToggleValue(
        'FEISHU_NOTIFY_STOCK_INTRADAY',
        values.FEISHU_NOTIFY_STOCK_INTRADAY?.trim() ?? '',
      ) === '1',
  };
}

export function getTokenConfigStatus(input: {
  username: string;
  userLabel: string;
  presetTokens: boolean;
}): TokenConfigStatus {
  const values = ensureUserEnvSeeded(input.username, input.presetTokens);
  const keys = {} as TokenConfigStatus['keys'];

  for (const key of SYNCED_ENV_KEYS) {
    keys[key] = buildKeyStatus(key, values[key]?.trim() ?? '');
  }

  const aiModel = keys[AI_MODEL_ENV]?.value?.trim() || DEFAULT_MODEL_ID;

  return {
    username: input.username,
    userLabel: input.userLabel,
    presetTokens: input.presetTokens,
    envPath: getUserEnvPath(input.username),
    aiModel,
    requiredApiKeyEnv: getApiKeyEnvForModel(aiModel),
    keys,
    feishu: getFeishuConfigStatus(values),
    restartRequired: false,
  };
}

export async function updateUserTokenConfig(
  username: string,
  presetTokens: boolean,
  userLabel: string,
  updates: Partial<Record<SyncedEnvKey, string | null>>,
): Promise<TokenConfigStatus> {
  const current = ensureUserEnvSeeded(username, presetTokens);

  for (const key of SYNCED_ENV_KEYS) {
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

  return getTokenConfigStatus({
    username,
    userLabel,
    presetTokens,
  });
}

export function assertAppUser(username: string): string {
  if (!isValidUsername(username)) {
    throw new Error('无效的用户');
  }
  return username;
}
