/** A 股 ETF：上交所 51/56/58，深交所 15/16/159 */
export function isEtfSymbol(code: string): boolean {
  const c = code.trim();
  if (!/^\d{6}$/.test(c)) return false;
  return (
    /^(51|56|58)\d{4}$/.test(c) ||
    /^(15|16)\d{4}$/.test(c) ||
    /^159\d{3}$/.test(c)
  );
}

/** 问财/东财板块、行业、概念等指数常见为 88xxxx，不应进入股票/ETF 交易池 */
export function isBoardIndexSymbol(code: string): boolean {
  return /^88\d{4}$/.test(code.trim());
}

export function isStockSymbol(code: string): boolean {
  const c = code.trim();
  if (!/^\d{6}$/.test(c) || isEtfSymbol(c) || isBoardIndexSymbol(c)) return false;
  return /^(6|0|3|8|4)\d{5}$/.test(c);
}

/** 科创板 688/689 — 需单独开通权限，默认零售账户不可买 */
export function isStarMarketSymbol(code: string): boolean {
  return /^68[89]\d{3}$/.test(code.trim());
}

/** 默认零售账户可买卖的 A 股（排除科创板） */
export function isRetailTradableStock(code: string): boolean {
  return isStockSymbol(code) && !isStarMarketSymbol(code);
}

export function isTradeSymbol(code: string): boolean {
  return isStockSymbol(code) || isEtfSymbol(code);
}

export function inferAssetType(symbol: string): 'stock' | 'etf' {
  return isEtfSymbol(symbol) ? 'etf' : 'stock';
}

export function exchangeSuffix(symbol: string): 'SH' | 'SZ' | 'BJ' {
  const c = symbol.trim();
  if (c.startsWith('6') || /^(51|56|58)\d{4}$/.test(c)) return 'SH';
  if (
    c.startsWith('0') ||
    c.startsWith('3') ||
    /^(15|16)\d{4}$/.test(c) ||
    /^159\d{3}$/.test(c)
  ) {
    return 'SZ';
  }
  if (c.startsWith('8') || c.startsWith('4')) return 'BJ';
  throw new Error(`无法识别交易所后缀: ${symbol}`);
}

export function tencentPrefix(symbol: string): 'sh' | 'sz' | 'bj' {
  const suffix = exchangeSuffix(symbol);
  if (suffix === 'SH') return 'sh';
  if (suffix === 'SZ') return 'sz';
  return 'bj';
}

export function eastmoneySecId(symbol: string): string {
  const suffix = exchangeSuffix(symbol);
  if (suffix === 'SH') return `1.${symbol.trim()}`;
  return `0.${symbol.trim()}`;
}

export function eastmoneyMarketCode(symbol: string): string {
  const suffix = exchangeSuffix(symbol);
  return `${suffix}${symbol.trim()}`;
}
