import '../config/load-env.js';

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MARKET_CSV_DIR } from '../mastra/config/paths.js';

export type MarketDataSyncOptions = {
  sourceDir: string | null;
  targetDir: string;
  zipName: string;
  minStockFiles: number;
  dryRun: boolean;
  force: boolean;
};

export type MarketDataSyncResult = {
  ok: true;
  skipped?: boolean;
  reason?: string;
  dryRun: boolean;
  sourceDir: string;
  targetDir: string;
  zipPath: string;
  importedStockCsvFiles: number;
  discoveredStockCsvFiles?: number;
  sourceLatestTradeDate: string;
  targetLatestTradeDate: string | null;
  firstStockCsv?: string | null;
  lastStockCsv?: string | null;
  meta?: {
    listed: string | null;
    delisted: string | null;
    tradingCalendar: string | null;
  };
  backups?: {
    stockQfqDir: string | null;
    listedCsv: string | null;
    delistedCsv: string | null;
    tradingCalendarCsv: string | null;
  };
  actions: string[];
};

type StockCsvFile = {
  sourcePath: string;
  targetName: string;
};

const HELP = `
Usage:
  pnpm market-data:sync --source /path/to/baidu/download/A股数据_zip

Options:
  -s, --source <dir>           百度网盘下载后的本地目录。也可用 INVESTMENT_AGENT_MARKET_SYNC_SOURCE
  -t, --target <dir>           market-csv 目标目录，默认 INVESTMENT_AGENT_MARKET_CSV_DIR 或内置 data/market-csv
      --zip-name <name>        要导入的压缩包名，默认 daily_qfq.zip
      --min-stock-files <num>  最少股票日线 CSV 数量，默认 5000
      --dry-run                只解压和校验，不替换项目数据
      --force                  即使源数据日期没有更新，也强制重新导入
  -h, --help                   显示帮助
`.trim();

function expandPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

export function resolveMarketDataSyncOptions(argv: string[] = []): MarketDataSyncOptions {
  const options: MarketDataSyncOptions = {
    sourceDir: process.env.INVESTMENT_AGENT_MARKET_SYNC_SOURCE?.trim()
      ? expandPath(process.env.INVESTMENT_AGENT_MARKET_SYNC_SOURCE)
      : null,
    targetDir: MARKET_CSV_DIR,
    zipName: 'daily_qfq.zip',
    minStockFiles: 5000,
    dryRun: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${HELP}\n`);
      process.exit(0);
    }
    if ((arg === '-s' || arg === '--source') && next) {
      options.sourceDir = expandPath(next);
      index += 1;
      continue;
    }
    if ((arg === '-t' || arg === '--target') && next) {
      options.targetDir = expandPath(next);
      index += 1;
      continue;
    }
    if (arg === '--zip-name' && next) {
      options.zipName = next.trim();
      index += 1;
      continue;
    }
    if (arg === '--min-stock-files' && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid --min-stock-files: ${next}`);
      }
      options.minStockFiles = parsed;
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}\n\n${HELP}`);
  }

  if (!options.sourceDir) {
    throw new Error(`Missing --source or INVESTMENT_AGENT_MARKET_SYNC_SOURCE\n\n${HELP}`);
  }

  return options;
}

function walkFiles(rootDir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

function normalizedBaseName(filePath: string): string {
  return path.basename(filePath).normalize('NFC');
}

function findByBaseName(files: string[], baseName: string): string | null {
  const normalized = baseName.normalize('NFC').toLowerCase();
  return (
    files.find((filePath) => normalizedBaseName(filePath).toLowerCase() === normalized) ?? null
  );
}

function readFirstChunk(filePath: string, bytes = 4096): string {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const readBytes = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, readBytes).toString('utf-8');
  } finally {
    closeSync(fd);
  }
}

function readTailChunk(filePath: string, bytes = 65536): string {
  const fd = openSync(filePath, 'r');
  try {
    const fileSize = statSync(filePath).size;
    const readBytes = Math.min(bytes, fileSize);
    const buffer = Buffer.alloc(readBytes);
    readSync(fd, buffer, 0, readBytes, Math.max(0, fileSize - readBytes));
    return buffer.toString('utf-8');
  } finally {
    closeSync(fd);
  }
}

function normalizeTradeDate(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^\uFEFF/, '').replace(/-/g, '').slice(0, 8);
  return normalized && /^\d{8}$/.test(normalized) ? normalized : null;
}

function latestTradeDateInCsv(filePath: string): string | null {
  const lines = readTailChunk(filePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const firstColumn = lines[index]?.split(',')[0];
    const tradeDate = normalizeTradeDate(firstColumn);
    if (tradeDate) return tradeDate;
  }

  return null;
}

function looksLikeDailyQfqCsv(filePath: string): boolean {
  const chunk = readFirstChunk(filePath);
  const lines = chunk.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0] ?? '';
  if (header.includes('日期') && header.includes('代码') && header.includes('收盘')) return true;
  if (header.includes('trade_date') && header.includes('symbol')) return true;

  const firstDataLine = lines[1] ?? lines[0] ?? '';
  const cols = firstDataLine.split(',');
  return cols.length >= 8 && /^\d{4}-?\d{2}-?\d{2}$/.test(cols[0]?.trim() ?? '');
}

function stockCsvTargetName(filePath: string): string | null {
  const baseName = normalizedBaseName(filePath);
  const exactMatch = baseName.match(/^(\d{6})_daily_qfq\.csv$/i);
  if (exactMatch) return `${exactMatch[1]}_daily_qfq.csv`;

  if (!baseName.toLowerCase().endsWith('.csv')) return null;
  if (baseName === '股票列表.csv' || baseName === '退市股票列表.csv' || baseName === '交易日历.csv') {
    return null;
  }

  const symbol = baseName.match(/(?:^|[^\d])(\d{6})(?:[^\d]|$)/)?.[1];
  if (!symbol || !looksLikeDailyQfqCsv(filePath)) return null;
  return `${symbol}_daily_qfq.csv`;
}

function extractZip(zipPath: string, outputDir: string): void {
  const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', outputDir], {
    encoding: 'utf-8',
  });

  if (result.error) {
    throw new Error(
      `Failed to run unzip. Please install unzip or extract ${path.basename(zipPath)} manually.\n${
        result.error.message
      }`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`Failed to unzip ${zipPath}\n${result.stderr || result.stdout}`);
  }
}

function timestampForPath(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function uniqueBackupPath(basePath: string, timestamp: string): string {
  let candidate = `${basePath}.backup-${timestamp}`;
  for (let index = 2; existsSync(candidate); index += 1) {
    candidate = `${basePath}.backup-${timestamp}-${index}`;
  }
  return candidate;
}

function discoverStockCsvFiles(extractedDir: string): StockCsvFile[] {
  const byTargetName = new Map<string, string>();
  for (const filePath of walkFiles(extractedDir)) {
    const targetName = stockCsvTargetName(filePath);
    if (!targetName) continue;
    if (!byTargetName.has(targetName)) byTargetName.set(targetName, filePath);
  }

  return [...byTargetName.entries()]
    .map(([targetName, sourcePath]) => ({ sourcePath, targetName }))
    .sort((a, b) => a.targetName.localeCompare(b.targetName));
}

function discoverExistingStockCsvFiles(targetDir: string): StockCsvFile[] {
  const stockQfqDir = path.join(targetDir, 'stock', 'qfq-daily');
  if (!existsSync(stockQfqDir)) return [];

  return readdirSync(stockQfqDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(/^(\d{6})_daily_qfq\.csv$/i);
      if (!match) return null;
      return {
        sourcePath: path.join(stockQfqDir, entry.name),
        targetName: `${match[1]}_daily_qfq.csv`,
      };
    })
    .filter((file): file is StockCsvFile => file != null)
    .sort((a, b) => a.targetName.localeCompare(b.targetName));
}

function latestTradeDateFromFiles(files: StockCsvFile[]): string | null {
  let latest: string | null = null;
  for (const file of files) {
    const tradeDate = latestTradeDateInCsv(file.sourcePath);
    if (tradeDate && (!latest || tradeDate > latest)) latest = tradeDate;
  }
  return latest;
}

function copyStockCsvsToStaging(files: StockCsvFile[], stagingDir: string): void {
  mkdirSync(stagingDir, { recursive: true });
  for (const file of files) {
    copyFileSync(file.sourcePath, path.join(stagingDir, file.targetName));
  }
}

function replaceStockQfqDir(input: {
  targetDir: string;
  stagingDir: string;
  timestamp: string;
}): string | null {
  const stockDir = path.join(input.targetDir, 'stock');
  const currentDir = path.join(stockDir, 'qfq-daily');
  mkdirSync(stockDir, { recursive: true });

  let backupDir: string | null = null;
  if (existsSync(currentDir)) {
    backupDir = uniqueBackupPath(currentDir, input.timestamp);
    renameSync(currentDir, backupDir);
  }

  try {
    renameSync(input.stagingDir, currentDir);
  } catch (error) {
    if (backupDir && existsSync(backupDir) && !existsSync(currentDir)) {
      renameSync(backupDir, currentDir);
    }
    throw error;
  }

  return backupDir;
}

function copyMetaFile(input: {
  sourcePath: string | null;
  targetPath: string;
  timestamp: string;
  dryRun: boolean;
}): string | null {
  if (!input.sourcePath) return null;
  if (input.dryRun) {
    return existsSync(input.targetPath) ? uniqueBackupPath(input.targetPath, input.timestamp) : null;
  }

  mkdirSync(path.dirname(input.targetPath), { recursive: true });
  let backupPath: string | null = null;
  if (existsSync(input.targetPath)) {
    backupPath = uniqueBackupPath(input.targetPath, input.timestamp);
    copyFileSync(input.targetPath, backupPath);
  }
  copyFileSync(input.sourcePath, input.targetPath);
  return backupPath;
}

export function syncMarketData(options: MarketDataSyncOptions): MarketDataSyncResult {
  const sourceDir = options.sourceDir;
  if (!sourceDir || !existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir ?? '(missing)'}`);
  }

  const sourceFiles = walkFiles(sourceDir);
  const zipPath = findByBaseName(sourceFiles, options.zipName);
  if (!zipPath) {
    throw new Error(`Cannot find ${options.zipName} under ${sourceDir}`);
  }

  const listedCsvPath = findByBaseName(sourceFiles, '股票列表.csv');
  const delistedCsvPath = findByBaseName(sourceFiles, '退市股票列表.csv');
  const tradingCalendarPath = findByBaseName(sourceFiles, '交易日历.csv');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'investment-agent-market-sync-'));
  const extractDir = path.join(tempDir, 'extracted');
  mkdirSync(extractDir, { recursive: true });

  let stagingDir: string | null = null;
  try {
    extractZip(zipPath, extractDir);
    const stockCsvFiles = discoverStockCsvFiles(extractDir);
    if (stockCsvFiles.length < options.minStockFiles) {
      throw new Error(
        `Only found ${stockCsvFiles.length} stock daily CSV files in ${options.zipName}; expected at least ${options.minStockFiles}.`,
      );
    }

    const sourceLatestTradeDate = latestTradeDateFromFiles(stockCsvFiles);
    if (!sourceLatestTradeDate) {
      throw new Error(`Cannot detect latest trade date from ${options.zipName}`);
    }

    const existingStockCsvFiles = discoverExistingStockCsvFiles(options.targetDir);
    const targetLatestTradeDate = latestTradeDateFromFiles(existingStockCsvFiles);
    if (!options.force && targetLatestTradeDate && sourceLatestTradeDate <= targetLatestTradeDate) {
      return {
        ok: true,
        skipped: true,
        reason: 'source_not_newer',
        dryRun: options.dryRun,
        sourceDir,
        targetDir: options.targetDir,
        zipPath,
        importedStockCsvFiles: 0,
        discoveredStockCsvFiles: stockCsvFiles.length,
        sourceLatestTradeDate,
        targetLatestTradeDate,
        actions: [
          `skipped: source latest date ${sourceLatestTradeDate} is not newer than target latest date ${targetLatestTradeDate}`,
        ],
      };
    }

    const timestamp = timestampForPath();
    const stockDir = path.join(options.targetDir, 'stock');
    stagingDir = options.dryRun
      ? path.join(tempDir, 'qfq-daily-staging')
      : path.join(stockDir, `.qfq-daily.sync-${timestamp}`);
    copyStockCsvsToStaging(stockCsvFiles, stagingDir);

    const metaDir = path.join(options.targetDir, 'meta');
    const actions: string[] = [];
    let stockBackupDir: string | null = null;

    if (options.dryRun) {
      actions.push(`dry-run: would replace ${path.join(stockDir, 'qfq-daily')}`);
    } else {
      stockBackupDir = replaceStockQfqDir({
        targetDir: options.targetDir,
        stagingDir,
        timestamp,
      });
      stagingDir = null;
      actions.push(`replaced ${path.join(stockDir, 'qfq-daily')}`);
    }

    const listedBackup = copyMetaFile({
      sourcePath: listedCsvPath,
      targetPath: path.join(metaDir, 'stock-list-listed.csv'),
      timestamp,
      dryRun: options.dryRun,
    });
    const delistedBackup = copyMetaFile({
      sourcePath: delistedCsvPath,
      targetPath: path.join(metaDir, 'stock-list-delisted.csv'),
      timestamp,
      dryRun: options.dryRun,
    });
    const calendarBackup = copyMetaFile({
      sourcePath: tradingCalendarPath,
      targetPath: path.join(metaDir, 'trading-calendar.csv'),
      timestamp,
      dryRun: options.dryRun,
    });

    return {
      ok: true,
      dryRun: options.dryRun,
      sourceDir,
      targetDir: options.targetDir,
      zipPath,
      importedStockCsvFiles: stockCsvFiles.length,
      sourceLatestTradeDate,
      targetLatestTradeDate,
      firstStockCsv: stockCsvFiles[0]?.targetName ?? null,
      lastStockCsv: stockCsvFiles.at(-1)?.targetName ?? null,
      meta: {
        listed: listedCsvPath ? 'stock-list-listed.csv' : null,
        delisted: delistedCsvPath ? 'stock-list-delisted.csv' : null,
        tradingCalendar: tradingCalendarPath ? 'trading-calendar.csv' : null,
      },
      backups: {
        stockQfqDir: stockBackupDir,
        listedCsv: listedBackup,
        delistedCsv: delistedBackup,
        tradingCalendarCsv: calendarBackup,
      },
      actions,
    };
  } finally {
    if (stagingDir && stagingDir.includes(`${path.sep}.qfq-daily.sync-`) && existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function isMainModule(): boolean {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;
}

if (isMainModule()) {
  try {
    const result = syncMarketData(resolveMarketDataSyncOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
