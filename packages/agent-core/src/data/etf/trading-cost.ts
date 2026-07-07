export const ETF_COMMISSION_RATE = 0.0003;
export const ETF_SLIPPAGE_RATE = 0.0005;
export const ETF_LOT_SIZE = 100;

export type EtfTradingCostRates = {
  commissionRate?: number;
  slippageRate?: number;
};

function resolveRate(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function resolveEtfTradingCostRates(
  rates: EtfTradingCostRates = {},
): Required<EtfTradingCostRates> {
  return {
    commissionRate: resolveRate(rates.commissionRate, ETF_COMMISSION_RATE),
    slippageRate: resolveRate(rates.slippageRate, ETF_SLIPPAGE_RATE),
  };
}

export function calcEtfBuyCost(input: {
  price: number;
  shares: number;
} & EtfTradingCostRates): {
  executionPrice: number;
  grossAmount: number;
  commission: number;
  totalCost: number;
} {
  const { commissionRate, slippageRate } = resolveEtfTradingCostRates(input);
  const executionPrice = input.price * (1 + slippageRate);
  const grossAmount = input.shares * executionPrice;
  const commission = grossAmount * commissionRate;
  return {
    executionPrice,
    grossAmount,
    commission,
    totalCost: grossAmount + commission,
  };
}

export function calcEtfSellProceeds(input: {
  price: number;
  shares: number;
} & EtfTradingCostRates): {
  executionPrice: number;
  grossAmount: number;
  commission: number;
  netProceeds: number;
} {
  const { commissionRate, slippageRate } = resolveEtfTradingCostRates(input);
  const executionPrice = input.price * (1 - slippageRate);
  const grossAmount = input.shares * executionPrice;
  const commission = grossAmount * commissionRate;
  return {
    executionPrice,
    grossAmount,
    commission,
    netProceeds: Math.max(0, grossAmount - commission),
  };
}

export function calcEtfBuyLotsByBudget(input: {
  budget: number;
  price: number;
  lotSize?: number;
} & EtfTradingCostRates): {
  shares: number;
  totalCost: number;
  executionPrice: number;
  commission: number;
} | null {
  const lotSize = Math.max(1, Math.floor(input.lotSize ?? ETF_LOT_SIZE));
  if (input.budget <= 0 || input.price <= 0) return null;

  const oneLot = calcEtfBuyCost({
    price: input.price,
    shares: lotSize,
    commissionRate: input.commissionRate,
    slippageRate: input.slippageRate,
  });
  const lots = Math.floor(input.budget / oneLot.totalCost);
  const shares = lots * lotSize;
  if (!Number.isFinite(shares) || shares <= 0) return null;

  const cost = calcEtfBuyCost({
    price: input.price,
    shares,
    commissionRate: input.commissionRate,
    slippageRate: input.slippageRate,
  });
  return {
    shares,
    totalCost: cost.totalCost,
    executionPrice: cost.executionPrice,
    commission: cost.commission,
  };
}
