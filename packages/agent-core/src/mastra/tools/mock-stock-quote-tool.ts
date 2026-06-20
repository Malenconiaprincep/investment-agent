import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const MOCK_QUOTES: Record<
  string,
  { name: string; price: number; changePercent: number; volume: string }
> = {
  '600519': {
    name: '贵州茅台',
    price: 1688.5,
    changePercent: 1.23,
    volume: '2.1万手',
  },
  '000001': {
    name: '平安银行',
    price: 11.42,
    changePercent: -0.35,
    volume: '48.6万手',
  },
  '300750': {
    name: '宁德时代',
    price: 198.6,
    changePercent: 2.15,
    volume: '15.3万手',
  },
};

export const mockStockQuoteTool = createTool({
  id: 'get-mock-stock-quote',
  description:
    '获取 A 股模拟行情（Phase 0 演示用，非真实数据）。输入 6 位股票代码，如 600519。',
  inputSchema: z.object({
    symbol: z
      .string()
      .regex(/^\d{6}$/)
      .describe('6 位 A 股代码，例如 600519'),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    name: z.string(),
    price: z.number(),
    changePercent: z.number(),
    volume: z.string(),
    currency: z.string(),
    market: z.string(),
    dataSource: z.string(),
    asOf: z.string(),
    disclaimer: z.string(),
  }),
  execute: async (inputData) => {
    const quote = MOCK_QUOTES[inputData.symbol];

    if (!quote) {
      throw new Error(
        `未找到代码 ${inputData.symbol} 的模拟数据。可用示例：600519、000001、300750`,
      );
    }

    return {
      symbol: inputData.symbol,
      name: quote.name,
      price: quote.price,
      changePercent: quote.changePercent,
      volume: quote.volume,
      currency: 'CNY',
      market: 'A股',
      dataSource: 'mock/demo',
      asOf: new Date().toISOString(),
      disclaimer: '此为模拟数据，仅供 Phase 0 功能演示，不可用于实际投资决策。',
    };
  },
});
