import { exchangeSuffix, isTradeSymbol } from './asset-type.js';

/** 6 位 A 股代码 → 带交易所后缀的 ts_code，如 600519.SH */
export function toTsCode(symbol: string): string {
  const code = symbol.trim().toUpperCase();

  if (code.includes('.')) {
    return code;
  }

  if (!/^\d{6}$/.test(code)) {
    throw new Error(`无效股票代码: ${symbol}，需要 6 位数字`);
  }

  if (!isTradeSymbol(code)) {
    throw new Error(`无法识别交易所后缀: ${symbol}`);
  }

  return `${code}.${exchangeSuffix(code)}`;
}

export function toSymbol(tsCode: string): string {
  return tsCode.split('.')[0] ?? tsCode;
}
