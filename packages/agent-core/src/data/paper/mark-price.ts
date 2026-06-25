import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import { isTradingSession } from './trading-calendar.js';

export type PaperMarkPrice = {
  price: number;
  source: 'intraday' | 'daily';
};

/** 模拟盘持仓市值：交易时段优先东财实时价，否则退回日 K 收盘 */
export async function resolvePaperMarkPrices(
  symbols: string[],
): Promise<Map<string, PaperMarkPrice>> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  const result = new Map<string, PaperMarkPrice>();
  if (unique.length === 0) return result;

  if (isTradingSession()) {
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
  }

  await Promise.all(
    unique
      .filter((symbol) => !result.has(symbol))
      .map(async (symbol) => {
        try {
          const daily = await getDailyQuote(symbol, 2);
          if (daily.latestClose != null && daily.latestClose > 0) {
            result.set(symbol, { price: daily.latestClose, source: 'daily' });
          }
        } catch {
          // 单票失败不阻断
        }
      }),
  );

  return result;
}
