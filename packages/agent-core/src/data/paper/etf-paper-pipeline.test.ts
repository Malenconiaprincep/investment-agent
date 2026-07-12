import { describe, expect, it } from 'vitest';
import {
  evaluateEtfBuyExecutionGuard,
  isEtfEvergreenAutoTradingEnabled,
} from './etf-paper-pipeline.js';

describe('evaluateEtfBuyExecutionGuard', () => {
  it('skips buy when bid/ask spread is too wide', () => {
    const result = evaluateEtfBuyExecutionGuard({
      shares: 1000,
      price: 1.01,
      bid1: 1,
      ask1: 1.01,
      prevClose: 1,
    });

    expect(result.action).toBe('skip');
    expect(result.reason).toContain('盘口价差');
  });

  it('skips buy when price is more than 4% above previous close', () => {
    const result = evaluateEtfBuyExecutionGuard({
      shares: 1000,
      price: 1.05,
      bid1: 1.049,
      ask1: 1.05,
      prevClose: 1,
    });

    expect(result.action).toBe('skip');
    expect(result.premiumPct).toBe(5);
    expect(result.reason).toContain('上涨 5.00%');
  });

  it('halves buy size when price is 2% to 4% above previous close', () => {
    const result = evaluateEtfBuyExecutionGuard({
      shares: 1100,
      price: 1.03,
      bid1: 1.029,
      ask1: 1.03,
      prevClose: 1,
    });

    expect(result.action).toBe('half');
    expect(result.shares).toBe(500);
    expect(result.premiumPct).toBe(3);
  });

  it('allows full buy when price premium and spread are acceptable', () => {
    const result = evaluateEtfBuyExecutionGuard({
      shares: 1000,
      price: 1.015,
      bid1: 1.014,
      ask1: 1.015,
      prevClose: 1,
    });

    expect(result.action).toBe('buy');
    expect(result.shares).toBe(1000);
    expect(result.premiumPct).toBe(1.5);
  });
});

describe('长青一号自动交易准入', () => {
  it('默认暂停自动开仓', () => {
    expect(isEtfEvergreenAutoTradingEnabled({})).toBe(false);
  });

  it('只有显式设置为 1 才恢复', () => {
    expect(isEtfEvergreenAutoTradingEnabled({ ETF_EVERGREEN_ALLOW_TRADING: 'true' })).toBe(false);
    expect(isEtfEvergreenAutoTradingEnabled({ ETF_EVERGREEN_ALLOW_TRADING: '1' })).toBe(true);
  });
});
