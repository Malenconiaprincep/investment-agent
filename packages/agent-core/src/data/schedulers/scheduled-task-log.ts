import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../mastra/config/paths.js';
import { formatTradeDate, getBeijingNow } from '../paper/trading-calendar.js';
import type { ScheduledTaskId } from './task-settings.js';

export type ScheduledTaskLogStatus = 'completed' | 'skipped' | 'failed' | 'disabled';

export type ScheduledTaskLogEntry = {
  taskId: ScheduledTaskId;
  label: string;
  tradeDate: string;
  ranAt: string;
  ranAtBeijing: string;
  status: ScheduledTaskLogStatus;
  reason?: string;
  summary?: string;
  elapsedMs?: number;
  source: 'background-worker';
};

export const SCHEDULED_TASK_LOG_RETENTION_DAYS = 3;

const LOG_PATH = path.join(DATA_DIR, 'scheduled-tasks.log');
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

let lastPurgeMs = 0;

function formatBeijingLogTime(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function getScheduledTaskLogRetentionCutoffTradeDate(
  days = SCHEDULED_TASK_LOG_RETENTION_DAYS,
): string {
  const date = getBeijingNow();
  date.setDate(date.getDate() - (days - 1));
  return formatTradeDate(date);
}

function parseLogLine(line: string): ScheduledTaskLogEntry | null {
  try {
    return JSON.parse(line) as ScheduledTaskLogEntry;
  } catch {
    return null;
  }
}

function readAllScheduledTaskLogEntries(): ScheduledTaskLogEntry[] {
  if (!existsSync(LOG_PATH)) return [];

  const cutoff = getScheduledTaskLogRetentionCutoffTradeDate();
  const lines = readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const entries: ScheduledTaskLogEntry[] = [];

  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (!parsed || parsed.tradeDate < cutoff) continue;
    entries.push(parsed);
  }

  entries.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  return entries;
}

export function purgeOldScheduledTaskLogs(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastPurgeMs < PURGE_INTERVAL_MS) return;
  lastPurgeMs = nowMs;

  if (!existsSync(LOG_PATH)) return;

  const cutoff = getScheduledTaskLogRetentionCutoffTradeDate();
  const lines = readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const kept: string[] = [];

  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (parsed && parsed.tradeDate >= cutoff) {
      kept.push(line);
    }
  }

  if (kept.length === lines.length) return;
  writeFileSync(LOG_PATH, kept.length ? `${kept.join('\n')}\n` : '', 'utf-8');
}

export function appendScheduledTaskLog(
  input: Omit<ScheduledTaskLogEntry, 'ranAt' | 'ranAtBeijing'> & {
    ranAt?: string;
  },
) {
  const ranAt = input.ranAt ?? new Date().toISOString();
  const entry: ScheduledTaskLogEntry = {
    ...input,
    ranAt,
    ranAtBeijing: formatBeijingLogTime(new Date(ranAt)),
  };

  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf-8');
  purgeOldScheduledTaskLogs();
}

export function readRecentScheduledTaskLogs(input?: {
  limit?: number;
  tradeDate?: string;
  taskId?: ScheduledTaskId;
}): ScheduledTaskLogEntry[] {
  purgeOldScheduledTaskLogs(true);

  const limit = Math.min(Math.max(input?.limit ?? 200, 1), 1000);
  let entries = readAllScheduledTaskLogEntries();

  if (input?.tradeDate) {
    entries = entries.filter((entry) => entry.tradeDate === input.tradeDate);
  }
  if (input?.taskId) {
    entries = entries.filter((entry) => entry.taskId === input.taskId);
  }

  return entries.slice(0, limit);
}

export function listScheduledTaskLogTradeDates(): string[] {
  purgeOldScheduledTaskLogs(true);
  return [...new Set(readAllScheduledTaskLogEntries().map((entry) => entry.tradeDate))].sort(
    (a, b) => b.localeCompare(a),
  );
}

export function clearScheduledTaskLogs(): { cleared: boolean } {
  mkdirSync(DATA_DIR, { recursive: true });
  const cleared =
    existsSync(LOG_PATH) && readFileSync(LOG_PATH, 'utf-8').length > 0;
  writeFileSync(LOG_PATH, '', 'utf-8');
  lastPurgeMs = Date.now();
  return { cleared };
}

export function getScheduledTaskLogPath(): string {
  return LOG_PATH;
}
