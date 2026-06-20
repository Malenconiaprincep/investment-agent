import type { DataMeta, MarketDataSource } from './types.js';
import { MARKET_DISCLAIMER } from './types.js';

export function buildMeta(
  dataSource: MarketDataSource,
  cached: boolean,
): DataMeta {
  return {
    dataSource,
    asOf: new Date().toISOString(),
    cached,
    disclaimer: MARKET_DISCLAIMER,
  };
}
