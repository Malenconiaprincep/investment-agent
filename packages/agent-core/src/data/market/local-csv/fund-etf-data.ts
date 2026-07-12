import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MARKET_CSV_DIR } from '../../../mastra/config/paths.js';
import { parseLocalDailyCsv, type LocalDailyKlineBar } from './etf-daily.js';

export type FundEtfAdjustment = 'qfq' | 'bfq';

export type FundEtfMetadata = {
  symbol: string;
  name: string;
  fullName: string;
  indexCode: string | null;
  indexName: string | null;
  inceptionDate: string | null;
  listingDate: string | null;
  status: 'L' | 'P' | 'D' | string;
  exchange: string;
  manager: string;
  managementFeePct: number | null;
  channelType: string;
};

export type FundEtfDataAudit = {
  generatedAt: string;
  dataRoot: string;
  metadataCount: number;
  listedCount: number;
  pendingCount: number;
  delistedCount: number;
  qfqFileCount: number;
  bfqFileCount: number;
  delistedHistoryFileCount: number;
  qfqRowCount: number;
  latestTradeDate: string | null;
  latestFileCount: number;
  invalidOhlcRowCount: number;
  zeroVolumeRowCount: number;
  strategyPoolMissing: string[];
  warnings: string[];
};

const DEFAULT_FUND_ROOT = path.join(
  MARKET_CSV_DIR,
  'stock',
  'baidu-data',
  '基金数据',
);
const FUND_ROOT = process.env.INVESTMENT_AGENT_FUND_DATA_DIR?.trim()
  ? path.resolve(process.env.INVESTMENT_AGENT_FUND_DATA_DIR)
  : DEFAULT_FUND_ROOT;
const QFQ_DIR = path.join(MARKET_CSV_DIR, 'etf', 'fund-qfq-daily');
const BFQ_DIR = path.join(MARKET_CSV_DIR, 'etf', 'fund-bfq-daily');
const DELISTED_DIR = path.join(MARKET_CSV_DIR, 'etf', 'fund-delisted-daily');
const METADATA_PATH = path.join(FUND_ROOT, 'ETF基础信息列表.csv');

function normalizeSymbol(value: string | undefined) {
  return value?.match(/\d{6}/)?.[0] ?? '';
}

function normalizeDate(value: string | undefined) {
  const normalized = value?.trim().replace(/-/g, '').slice(0, 8) ?? '';
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

function parseNullableNumber(value: string | undefined) {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) ? parsed : null;
}

export function getFundEtfDataRoot() {
  return FUND_ROOT;
}

export function loadFundEtfMetadata(): FundEtfMetadata[] {
  if (!existsSync(METADATA_PATH)) return [];
  const lines = readFileSync(METADATA_PATH, 'utf-8').split(/\r?\n/);
  return lines.slice(1).flatMap((line) => {
    const columns = line.trim().split(',');
    const symbol = normalizeSymbol(columns[0]);
    if (!symbol) return [];
    return [{
      symbol,
      name: columns[1]?.trim() ?? symbol,
      fullName: columns[3]?.trim() ?? columns[1]?.trim() ?? symbol,
      indexCode: columns[4]?.trim() || null,
      indexName: columns[5]?.trim() || null,
      inceptionDate: normalizeDate(columns[6]),
      listingDate: normalizeDate(columns[7]),
      status: columns[8]?.trim() ?? '',
      exchange: columns[9]?.trim() ?? '',
      manager: columns[10]?.trim() ?? '',
      managementFeePct: parseNullableNumber(columns[12]),
      channelType: columns[13]?.trim() ?? '',
    }];
  });
}

export function listFundEtfDailySymbols(adjustment: FundEtfAdjustment = 'qfq') {
  const directory = adjustment === 'qfq' ? QFQ_DIR : BFQ_DIR;
  if (!existsSync(directory)) return [];
  const suffix = `_daily_${adjustment}.csv`;
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(suffix))
    .map((fileName) => normalizeSymbol(fileName))
    .filter(Boolean)
    .sort();
}

export function loadFundEtfDaily(
  symbol: string,
  adjustment: FundEtfAdjustment = 'qfq',
): LocalDailyKlineBar[] {
  const normalized = normalizeSymbol(symbol);
  const directory = adjustment === 'qfq' ? QFQ_DIR : BFQ_DIR;
  const filePath = path.join(directory, `${normalized}_daily_${adjustment}.csv`);
  if (!normalized || !existsSync(filePath)) return [];
  return parseLocalDailyCsv(readFileSync(filePath, 'utf-8'));
}

function isValidOhlc(bar: LocalDailyKlineBar) {
  const values = [bar.open, bar.close, bar.high, bar.low];
  if (values.some((value) => value == null || value <= 0)) return false;
  return bar.high! >= Math.max(bar.open!, bar.close!, bar.low!)
    && bar.low! <= Math.min(bar.open!, bar.close!, bar.high!);
}

export function auditFundEtfData(strategySymbols: string[] = []): FundEtfDataAudit {
  const metadata = loadFundEtfMetadata();
  const qfqSymbols = listFundEtfDailySymbols('qfq');
  const bfqSymbols = listFundEtfDailySymbols('bfq');
  let qfqRowCount = 0;
  let invalidOhlcRowCount = 0;
  let zeroVolumeRowCount = 0;
  const latestBySymbol = new Map<string, string>();
  for (const symbol of qfqSymbols) {
    const bars = loadFundEtfDaily(symbol, 'qfq');
    qfqRowCount += bars.length;
    for (const bar of bars) {
      if (!isValidOhlc(bar)) invalidOhlcRowCount += 1;
      if (bar.vol == null || bar.vol <= 0) zeroVolumeRowCount += 1;
    }
    const latest = bars[0]?.tradeDate;
    if (latest) latestBySymbol.set(symbol, latest);
  }
  const latestTradeDate = [...latestBySymbol.values()].sort().at(-1) ?? null;
  const qfqSet = new Set(qfqSymbols);
  const bfqSet = new Set(bfqSymbols);
  const strategyPoolMissing = [...new Set(strategySymbols.map(normalizeSymbol))]
    .filter((symbol) => !qfqSet.has(symbol) || !bfqSet.has(symbol));
  const warnings: string[] = [];
  if (invalidOhlcRowCount > 0) {
    warnings.push(`发现 ${invalidOhlcRowCount} 条非正或高低价倒挂的前复权记录，回测必须过滤。`);
  }
  if (zeroVolumeRowCount > 0) {
    warnings.push(`发现 ${zeroVolumeRowCount} 条零成交量记录，动态股票池应视为不可交易。`);
  }
  if (qfqSet.size !== bfqSet.size) {
    warnings.push(`前复权 ${qfqSet.size} 只、不复权 ${bfqSet.size} 只，成交模拟前需逐标的校验双口径。`);
  }
  if (strategyPoolMissing.length > 0) {
    warnings.push(`当前策略池缺少双口径数据：${strategyPoolMissing.join('、')}。`);
  }
  return {
    generatedAt: new Date().toISOString(),
    dataRoot: FUND_ROOT,
    metadataCount: metadata.length,
    listedCount: metadata.filter((item) => item.status === 'L').length,
    pendingCount: metadata.filter((item) => item.status === 'P').length,
    delistedCount: metadata.filter((item) => item.status === 'D').length,
    qfqFileCount: qfqSet.size,
    bfqFileCount: bfqSet.size,
    delistedHistoryFileCount: existsSync(DELISTED_DIR)
      ? readdirSync(DELISTED_DIR).filter((fileName) => fileName.endsWith('.csv')).length
      : 0,
    qfqRowCount,
    latestTradeDate,
    latestFileCount: latestTradeDate
      ? [...latestBySymbol.values()].filter((value) => value === latestTradeDate).length
      : 0,
    invalidOhlcRowCount,
    zeroVolumeRowCount,
    strategyPoolMissing,
    warnings,
  };
}
