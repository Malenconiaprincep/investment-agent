import {
  callIwencaiTool,
  isIwencaiMcpConfigured,
} from '../../mastra/mcp/iwencai.js';
import { IWENCAI_DISCLAIMER } from './types.js';

export type SectorItem = {
  name: string;
  reason: string;
  dataSource: 'iwencai';
};

export type CandidateItem = {
  symbol: string;
  name: string;
  thesis: string;
  dataSource: 'iwencai' | 'eastmoney';
};

const FALLBACK_SECTOR_QUERY = '今日概念板块涨幅排名前10';
const FALLBACK_STOCK_QUERY = '今日A股主力净流入前20，排除ST';

function walkValues(node: unknown, out: unknown[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walkValues(item, out);
    return;
  }
  if (typeof node === 'object') {
    out.push(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
      walkValues(value, out);
    }
  }
}

function extractSymbol(text: string): string | null {
  const match = text.match(/\b([036]\d{5})\b/);
  return match?.[1] ?? null;
}

function pickName(obj: Record<string, unknown>): string | null {
  for (const key of [
    'name',
    'stock_name',
    'secname',
    '证券简称',
    '股票简称',
    '板块名称',
    '指数简称',
    '行业',
  ]) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function rowsFromQuery2Data(data: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  if (!data || typeof data !== 'object') return rows;

  const root = data as Record<string, unknown>;
  const datas = root.datas;
  if (!Array.isArray(datas)) return rows;

  for (const block of datas) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const columns = b.columns;
    const dataRows = b.data;

    if (Array.isArray(columns) && Array.isArray(dataRows)) {
      const colNames = columns.map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && 'name' in c) {
          return String((c as { name: unknown }).name);
        }
        return String(c);
      });

      for (const row of dataRows) {
        if (!Array.isArray(row)) continue;
        const obj: Record<string, unknown> = {};
        row.forEach((cell, index) => {
          obj[colNames[index] ?? `col${index}`] = cell;
        });
        rows.push(obj);
      }
      continue;
    }

    rows.push(b);
  }

  return rows;
}

function isStockRow(row: Record<string, unknown>): boolean {
  const text = JSON.stringify(row);
  if (/\b[036]\d{5}\b/.test(text) && /股票/.test(text)) return true;
  return Object.keys(row).some(
    (key) => key.includes('股票代码') || key.includes('stock_code'),
  );
}

export function parseSectorsFromIwencai(data: unknown, limit = 5): SectorItem[] {
  const rows = rowsFromQuery2Data(data);
  const sectors: SectorItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (isStockRow(row)) continue;
    const name =
      pickName(row) ??
      Object.values(row).find(
        (v) => typeof v === 'string' && v.length >= 2 && v.length <= 20,
      );
    if (typeof name !== 'string') continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const reason =
      Object.entries(row)
        .filter(([k, v]) => k !== 'name' && v != null && String(v).trim())
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${v}`)
        .join('；') || '问财板块筛选结果';

    sectors.push({ name, reason, dataSource: 'iwencai' });
    if (sectors.length >= limit) break;
  }

  return sectors;
}

export function parseCandidatesFromIwencai(
  data: unknown,
  limit = 10,
): CandidateItem[] {
  const rows = rowsFromQuery2Data(data);
  const candidates: CandidateItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const rowText = JSON.stringify(row);
    const symbol = extractSymbol(rowText);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);

    const name = pickName(row) ?? symbol;
    const thesis =
      Object.entries(row)
        .filter(([k, v]) => !k.includes('code') && v != null)
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${v}`)
        .join('；') || '问财选股条件命中';

    candidates.push({
      symbol,
      name,
      thesis,
      dataSource: 'iwencai',
    });

    if (candidates.length >= limit) break;
  }

  if (candidates.length === 0) {
    const flat: unknown[] = [];
    walkValues(data, flat);
    for (const item of flat) {
      if (typeof item !== 'string') continue;
      const symbol = extractSymbol(item);
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      candidates.push({
        symbol,
        name: symbol,
        thesis: item.slice(0, 120),
        dataSource: 'iwencai',
      });
      if (candidates.length >= limit) break;
    }
  }

  return candidates;
}

export async function fetchIwencaiSectors(query: string, limit = 5) {
  if (!isIwencaiMcpConfigured()) {
    throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY');
  }

  const raw = await callIwencaiTool('hithink_sector_selector', {
    query,
    limit: String(limit),
  });

  const sectors = parseSectorsFromIwencai(raw, limit);

  return {
    raw,
    sectors,
    disclaimer: IWENCAI_DISCLAIMER,
  };
}

/** 主 query 无结果时，用通用强势板块 query 重试 */
export async function fetchIwencaiSectorsWithFallback(
  query: string,
  limit = 5,
  options?: { allowFallback?: boolean },
) {
  let result = await fetchIwencaiSectors(query, limit);
  if (
    options?.allowFallback !== false &&
    result.sectors.length === 0 &&
    query !== FALLBACK_SECTOR_QUERY
  ) {
    const fallback = await fetchIwencaiSectors(FALLBACK_SECTOR_QUERY, limit);
    if (fallback.sectors.length > 0) {
      return { ...fallback, usedFallback: true as const };
    }
  }
  return { ...result, usedFallback: false as const };
}

export async function fetchIwencaiCandidates(
  query: string,
  sectorHint: string | undefined,
  limit = 10,
) {
  if (!isIwencaiMcpConfigured()) {
    throw new Error('问财未配置：请在 .env 设置 IWENCAI_API_KEY');
  }

  const fullQuery = sectorHint ? `${query}，所属板块：${sectorHint}` : query;
  const raw = await callIwencaiTool('hithink_astock_selector', {
    query: fullQuery,
    limit: String(limit),
  });

  return {
    raw,
    candidates: parseCandidatesFromIwencai(raw, limit),
    disclaimer: IWENCAI_DISCLAIMER,
  };
}

/** 主 query 无结果时，用通用主力净流入 query 重试 */
export async function fetchIwencaiCandidatesWithFallback(
  query: string,
  sectorHint: string | undefined,
  limit = 10,
  options?: { allowFallback?: boolean },
) {
  let result = await fetchIwencaiCandidates(query, sectorHint, limit);
  if (options?.allowFallback !== false && result.candidates.length === 0) {
    const fallbackQuery = sectorHint
      ? `${sectorHint}板块，主力净流入前20，排除ST`
      : FALLBACK_STOCK_QUERY;
    if (fallbackQuery !== query) {
      const fallback = await fetchIwencaiCandidates(
        fallbackQuery,
        sectorHint,
        limit,
      );
      if (fallback.candidates.length > 0) {
        return { ...fallback, usedFallback: true as const };
      }
    }
  }
  return { ...result, usedFallback: false as const };
}

export async function fetchIwencaiIndustryContext(query: string) {
  if (!isIwencaiMcpConfigured()) {
    return { raw: null, summary: null };
  }

  const raw = await callIwencaiTool('hithink_industry_query', {
    query,
    limit: '5',
  });

  const rows = rowsFromQuery2Data(raw);
  const summary =
    rows
      .slice(0, 3)
      .map((row) =>
        Object.entries(row)
          .slice(0, 4)
          .map(([k, v]) => `${k}: ${v}`)
          .join('，'),
      )
      .join('\n') || null;

  return { raw, summary };
}
