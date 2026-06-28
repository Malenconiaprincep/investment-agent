import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { AI_API_KEY_ENVS, AI_MODEL_ENV } from '../mastra/config/model-providers.js';

export const CONFIGURABLE_KEYS = [
  AI_MODEL_ENV,
  ...AI_API_KEY_ENVS,
  'IWENCAI_API_KEY',
  'IWENCAI_BASE_URL',
  'LIBSQL_URL',
  'LIBSQL_AUTH_TOKEN',
  'AGENT_CORE_TOKEN',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_CHAT_ID',
  'FEISHU_WEBHOOK_URL',
  'FEISHU_WEBHOOK_SECRET',
] as const;

export type ConfigurableKey = (typeof CONFIGURABLE_KEYS)[number];

export type EnvConfigStatus = {
  envPath: string | null;
  keys: Record<
    ConfigurableKey,
    { configured: boolean; masked?: string }
  >;
  restartRequired: boolean;
};

function resolveEnvPath(): string | null {
  const explicit =
    process.env.DOTENV_CONFIG_PATH?.trim() ||
    process.env.INVESTMENT_AGENT_ENV_PATH?.trim();
  if (explicit) return explicit;

  const cwdEnv = `${process.cwd()}/.env`;
  if (existsSync(cwdEnv)) return cwdEnv;

  return null;
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
  const lines: string[] = [
    '# 投研助手配置（可通过应用内「API 配置」修改）',
    '',
  ];

  const sections: Array<{ title: string; keys: ConfigurableKey[] }> = [
    {
      title: 'AI 模型（API Key 须与所选模型提供商对应）',
      keys: [AI_MODEL_ENV, ...AI_API_KEY_ENVS],
    },
    {
      title: '问财 MCP（智能选股 / 投委会）',
      keys: ['IWENCAI_API_KEY', 'IWENCAI_BASE_URL'],
    },
    {
      title: 'Turso 远程数据库（可选）',
      keys: ['LIBSQL_URL', 'LIBSQL_AUTH_TOKEN'],
    },
    {
      title: 'agent-core 鉴权（可选）',
      keys: ['AGENT_CORE_TOKEN'],
    },
    {
      title: '飞书推送（可选，App 与 Webhook 二选一，App 优先）',
      keys: [
        'FEISHU_APP_ID',
        'FEISHU_APP_SECRET',
        'FEISHU_CHAT_ID',
        'FEISHU_WEBHOOK_URL',
        'FEISHU_WEBHOOK_SECRET',
      ],
    },
  ];

  const written = new Set<string>();

  for (const section of sections) {
    const sectionKeys = section.keys.filter((key) => values[key]?.trim());
    if (sectionKeys.length === 0) continue;

    lines.push(`# ${section.title}`);
    for (const key of section.keys) {
      const value = values[key]?.trim();
      if (!value) continue;
      lines.push(`${key}=${value}`);
      written.add(key);
    }
    lines.push('');
  }

  for (const key of CONFIGURABLE_KEYS) {
    if (written.has(key)) continue;
    const value = values[key]?.trim();
    if (!value) continue;
    lines.push(`${key}=${value}`);
  }

  return `${lines.join('\n').trim()}\n`;
}

export function getEnvConfigStatus(): EnvConfigStatus {
  const envPath = resolveEnvPath();
  const fileValues = envPath ? parseEnvFile(envPath) : {};

  const keys = {} as EnvConfigStatus['keys'];
  for (const key of CONFIGURABLE_KEYS) {
    const runtime = process.env[key]?.trim();
    const file = fileValues[key]?.trim();
    const value = runtime || file || '';
    if (!value) {
      keys[key] = { configured: false };
      continue;
    }
    if (key === AI_MODEL_ENV) {
      keys[key] = { configured: true, masked: value };
    } else {
      keys[key] = { configured: true, masked: maskSecret(value) };
    }
  }

  return {
    envPath,
    keys,
    restartRequired: false,
  };
}

export function updateEnvConfig(
  updates: Partial<Record<ConfigurableKey, string | null>>,
): EnvConfigStatus {
  const envPath = resolveEnvPath();
  if (!envPath) {
    throw new Error('未找到配置文件路径，请检查 DOTENV_CONFIG_PATH');
  }

  const current = parseEnvFile(envPath);

  for (const key of CONFIGURABLE_KEYS) {
    if (!(key in updates)) continue;
    const next = updates[key];
    if (next === null || next === undefined || !next.trim()) {
      delete current[key];
      delete process.env[key];
      continue;
    }
    const trimmed = next.trim();
    current[key] = trimmed;
    process.env[key] = trimmed;
  }

  writeFileSync(envPath, serializeEnvFile(current), 'utf-8');

  return {
    ...getEnvConfigStatus(),
    restartRequired: true,
  };
}
