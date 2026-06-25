import type { PriceLineSpec } from '@/components/charts/KlineChart';

type MomentumPriceLinesInput = {
  stopLossPrice?: number | null;
  trailingStopPrice?: number | null;
  latestRedClose?: number | null;
  latestDiamondClose?: number | null;
  latestDiamondStrength?: 'red' | 'blue' | null;
};

export function buildMomentumPriceLines(input: MomentumPriceLinesInput): PriceLineSpec[] {
  const lines: PriceLineSpec[] = [];
  const diamondClose = input.latestDiamondClose ?? input.latestRedClose ?? null;
  if (diamondClose != null) {
    const strength = input.latestDiamondStrength ?? 'red';
    lines.push({
      price: diamondClose,
      color: strength === 'red' ? '#e85d5d' : '#5b9cf5',
      title: strength === 'red' ? '最近红钻' : '最近蓝钻',
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
