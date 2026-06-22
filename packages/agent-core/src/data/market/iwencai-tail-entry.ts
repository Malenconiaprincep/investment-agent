import { callIwencaiTool } from '../../mastra/mcp/iwencai.js';
import type { TailEntryStockPick } from './tail-entry-outlook.js';
import {
  extractSymbol,
  parseCandidatesFromIwencai,
  pickName,
  rowsFromQuery2Data,
} from './iwencai-screen.js';

export type IwencaiConceptBoard = {
  boardCode: string;
  name: string;
  pctChg: number;
  netInflowYi: number;
};

function pickPctChg(row: Record<string, unknown>): number {
  for (const [key, value] of Object.entries(row)) {
    if (!/涨幅|涨跌|涨跌幅/.test(key)) continue;
    const n = Number.parseFloat(String(value).replace(/%/g, ''));
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function pickNetInflowYi(row: Record<string, unknown>): number {
  for (const [key, value] of Object.entries(row)) {
    if (!/净流入|资金流入|主力/.test(key)) continue;
    const str = String(value).replace(/,/g, '');
    const match = str.match(/-?\d+(\.\d+)?/);
    if (!match) continue;
    const n = Number.parseFloat(match[0]);
    if (Number.isNaN(n)) continue;
    if (/亿/.test(str)) return n;
    if (/万/.test(str)) return n / 10000;
    if (Math.abs(n) >= 1e8) return n / 1e8;
    if (Math.abs(n) >= 1e4) return n / 1e4;
    return n;
  }
  return 0;
}

function isStockRow(row: Record<string, unknown>): boolean {
  const text = JSON.stringify(row);
  if (/\b[036]\d{5}\b/.test(text) && /股票/.test(text)) return true;
  return Object.keys(row).some(
    (key) => key.includes('股票代码') || key.includes('stock_code'),
  );
}

function rowToConceptBoard(row: Record<string, unknown>): IwencaiConceptBoard | null {
  if (isStockRow(row)) return null;
  const name = pickName(row);
  if (!name) return null;
  return {
    boardCode: name,
    name,
    pctChg: pickPctChg(row),
    netInflowYi: pickNetInflowYi(row),
  };
}

function rowToStockPick(row: Record<string, unknown>): TailEntryStockPick | null {
  const rowText = JSON.stringify(row);
  const symbol = extractSymbol(rowText);
  const name = pickName(row);
  if (!symbol || !name) return null;

  const pctChg = pickPctChg(row);
  const netInflowYi = pickNetInflowYi(row);
  const netInflowWan = netInflowYi * 10000;
  const isLimitUp = pctChg >= 9.9;

  return {
    symbol,
    name,
    pctChg,
    netInflowWan,
    tier: isLimitUp ? 'speculative' : netInflowWan >= 30000 ? 'first' : 'second',
    tierLabel: isLimitUp ? '博弈' : netInflowWan >= 30000 ? '中军' : '弹性',
    logic: isLimitUp
      ? '今日涨停，明日或有惯性但追高风险大'
      : netInflowWan >= 30000
        ? '问财筛选：资金流入居前'
        : '问财筛选：板块内涨幅靠前',
    riskNote: isLimitUp ? '已涨停，尾盘仅能排板或放弃' : undefined,
  };
}

function candidateToStockPick(input: {
  symbol: string;
  name: string;
  thesis: string;
}): TailEntryStockPick {
  const pctMatch = input.thesis.match(/涨跌幅[^:：\d-]*(-?\d+\.?\d*)%?/);
  const inflowMatch = input.thesis.match(/净流入[^:：\d-]*(-?\d+\.?\d*)/);
  const pctChg = pctMatch ? Number.parseFloat(pctMatch[1]) : 0;
  let netInflowWan = 0;
  if (inflowMatch) {
    const raw = Number.parseFloat(inflowMatch[1]);
    netInflowWan = /亿/.test(input.thesis) ? raw * 10000 : raw;
  }
  const isLimitUp = pctChg >= 9.9;

  return {
    symbol: input.symbol,
    name: input.name,
    pctChg,
    netInflowWan,
    tier: isLimitUp ? 'speculative' : netInflowWan >= 30000 ? 'first' : 'second',
    tierLabel: isLimitUp ? '博弈' : netInflowWan >= 30000 ? '中军' : '弹性',
    logic: input.thesis.slice(0, 80) || '问财筛选命中',
    riskNote: isLimitUp ? '已涨停，尾盘仅能排板或放弃' : undefined,
  };
}

async function queryIwencaiRows(
  tool: 'hithink_sector_selector' | 'hithink_astock_selector',
  query: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const raw = await callIwencaiTool(tool, {
    query,
    limit: String(limit),
  });
  return rowsFromQuery2Data(raw);
}

export async function fetchIwencaiConceptBoardRankings(
  limit = 20,
): Promise<IwencaiConceptBoard[]> {
  const rows = await queryIwencaiRows(
    'hithink_sector_selector',
    '今日概念板块涨幅排名前20，含涨跌幅和主力净流入',
    limit,
  );
  const boards = rows
    .map(rowToConceptBoard)
    .filter((item): item is IwencaiConceptBoard => item != null);
  if (boards.length > 0) return boards.slice(0, limit);

  const fallbackRows = await queryIwencaiRows(
    'hithink_sector_selector',
    '今日概念板块涨幅排名前10',
    limit,
  );
  return fallbackRows
    .map(rowToConceptBoard)
    .filter((item): item is IwencaiConceptBoard => item != null)
    .slice(0, limit);
}

export async function fetchIwencaiTopInflowStocks(
  limit = 10,
): Promise<TailEntryStockPick[]> {
  const raw = await callIwencaiTool('hithink_astock_selector', {
    query: '今日A股主力净流入前20，排除ST',
    limit: String(limit + 5),
  });
  const rows = rowsFromQuery2Data(raw);
  const fromRows = rows
    .map(rowToStockPick)
    .filter((item): item is TailEntryStockPick => item != null);
  if (fromRows.length > 0) return fromRows.slice(0, limit);

  return parseCandidatesFromIwencai(raw, limit).map(candidateToStockPick);
}

export async function fetchIwencaiBoardLeaderStocks(
  sectorName: string,
  limit = 5,
): Promise<TailEntryStockPick[]> {
  const raw = await callIwencaiTool('hithink_astock_selector', {
    query: `${sectorName}概念，今日涨幅前5，主力净流入，排除ST`,
    limit: String(limit + 2),
  });
  const rows = rowsFromQuery2Data(raw);
  const fromRows = rows
    .map(rowToStockPick)
    .filter((item): item is TailEntryStockPick => item != null);
  if (fromRows.length > 0) return fromRows.slice(0, limit);

  return parseCandidatesFromIwencai(raw, limit).map(candidateToStockPick);
}
