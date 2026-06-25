import type { PriceLineSpec } from '@/components/charts/KlineChart';

type MomentumPriceLinesInput = {
  stopLossPrice?: number | null;
  trailingStopPrice?: number | null;
  latestRedClose?: number | null;
};

export function buildMomentumPriceLines(input: MomentumPriceLinesInput): PriceLineSpec[] {
  const lines: PriceLineSpec[] = [];
  if (input.latestRedClose != null) {
    lines.push({
      price: input.latestRedClose,
      color: '#5b9cf5',
      title: '最近红钻',
    });
  }
  if (input.stopLossPrice != null) {
    lines.push({
      price: input.stopLossPrice,
      color: '#e07070',
      title: '止损参考',
    });
  }
  if (input.trailingStopPrice != null && input.trailingStopPrice > 0) {
    lines.push({
      price: input.trailingStopPrice,
      color: '#6bc77a',
      title: '移动止盈参考',
    });
  }
  return lines;
}
