import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../mastra/config/paths.js';

export type LibsqlClientOptions = {
  url: string;
  authToken?: string;
};

function vercelDataDir(): string {
  const dir = path.join('/tmp', 'investment-agent-data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fileDbUrl(filename: string): string {
  if (process.env.VERCEL) {
    return `file:${path.join(vercelDataDir(), filename)}`;
  }
  return `file:${path.join(DATA_DIR, filename)}`;
}

/** 生产环境推荐 Turso：LIBSQL_URL + LIBSQL_AUTH_TOKEN */
export function getPrimaryLibsqlOptions(
  filename = 'research-reports.db',
): LibsqlClientOptions {
  const remoteUrl = process.env.LIBSQL_URL?.trim();
  if (remoteUrl) {
    const authToken = process.env.LIBSQL_AUTH_TOKEN?.trim();
    return authToken ? { url: remoteUrl, authToken } : { url: remoteUrl };
  }

  return { url: fileDbUrl(filename) };
}

export function getNotesVectorUrl(): string {
  const remoteUrl = process.env.LIBSQL_NOTES_URL?.trim();
  if (remoteUrl) {
    return remoteUrl;
  }
  return fileDbUrl('research-notes.db');
}

export function getMastraMemoryUrl(): string {
  const remoteUrl = process.env.LIBSQL_MEMORY_URL?.trim();
  if (remoteUrl) {
    return remoteUrl;
  }
  return fileDbUrl('mastra.db');
}
