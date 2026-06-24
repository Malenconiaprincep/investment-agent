export function getLikelyUpLimitPct(symbol: string, name?: string | null): number {
  const normalizedName = name?.trim() ?? '';
  if (/(^|\*)ST/.test(normalizedName)) return 4.8;
  if (symbol.startsWith('8') || symbol.startsWith('4')) return 29.5;
  if (symbol.startsWith('3') || symbol.startsWith('68')) return 19.5;
  return 9.5;
}

function getLimitRatio(symbol: string, name?: string | null): number {
  const limitPct = getLikelyUpLimitPct(symbol, name);
  if (limitPct >= 29) return 1.3;
  if (limitPct >= 19) return 1.2;
  if (limitPct <= 5) return 1.05;
  return 1.1;
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isLikelyLimitUp(input: {
  symbol: string;
  name?: string | null;
  pctChg?: number | null;
  price?: number | null;
  prevClose?: number | null;
}): boolean {
  const limitPct = getLikelyUpLimitPct(input.symbol, input.name);
  if (input.pctChg != null && input.pctChg >= limitPct) return true;

  if (
    input.price != null &&
    input.prevClose != null &&
    Number.isFinite(input.price) &&
    Number.isFinite(input.prevClose) &&
    input.price > 0 &&
    input.prevClose > 0
  ) {
    const upLimitPrice = roundPrice(
      input.prevClose * getLimitRatio(input.symbol, input.name),
    );
    return input.price >= upLimitPrice - 0.01;
  }

  return false;
}
