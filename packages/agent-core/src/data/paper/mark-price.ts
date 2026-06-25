import { isEtfSymbol } from '../market/asset-type.js';
import { fetchDailyKlines } from '../market/free/tencent.js';
import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';

export type PaperMarkPrice = {
  price: number;
  source: 'intraday' | 'daily';
};

async function resolveDailyMarkPrice(symbol: string): Promise<number | null> {
  if (isEtfSymbol(symbol)) {
    try {
      const { quotes } = await fetchDailyKlines(symbol, 2);
      const close = quotes[0]?.close;
      if (close != null && close > 0) return close;
    } catch {
      // 退回通用日 K
    }
  }

  try {
    const daily = await getDailyQuote(symbol, 2);
    if (daily.latestClose != null && daily.latestClose > 0) {
      return daily.latestClose;
    }
  } catch {
    // 单票失败不阻断
  }

  return null;
}

/** 模拟盘持仓市值：优先东财现价（含收盘后当日价），否则退回最新日 K（ETF 不用 stale 本地 CSV） */
export async function resolvePaperMarkPrices(
  symbols: string[],
): Promise<Map<string, PaperMarkPrice>> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  const result = new Map<string, PaperMarkPrice>();
  if (unique.length === 0) return result;

  try {
    const intraday = await fetchIntradayQuotes(unique);
    for (const symbol of unique) {
      const quote = intraday.get(symbol);
      if (quote?.price != null && quote.price > 0) {
        result.set(symbol, { price: quote.price, source: 'intraday' });
      }
    }
  } catch {
    // 实时价失败时退回日 K
  }

  await Promise.all(
    unique
      .filter((symbol) => !result.has(symbol))
      .map(async (symbol) => {
        const close = await resolveDailyMarkPrice(symbol);
        if (close != null) {
          result.set(symbol, { price: close, source: 'daily' });
        }
      }),
  );

  return result;
}
