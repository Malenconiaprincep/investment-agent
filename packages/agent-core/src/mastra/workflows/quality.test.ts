import { describe, expect, it } from 'vitest';
import { checkCommitteeQuality } from './committee/quality.js';
import { checkReportQuality, extractSymbol } from './research/quality.js';
import { checkSectorScreenQuality } from './sector-screen/quality.js';

describe('workflow quality checks', () => {
  it('passes a report with required sections and disclaimer keyword', () => {
    const report = [
      '## 公司概况',
      '## 行情快照',
      '## 财务指标',
      '## 数据来源',
      '## 风险提示',
      '## 投资建议',
      '## 免责声明',
      '本内容不构成投资建议。',
    ].join('\n\n');

    expect(checkReportQuality(report)).toEqual({
      passed: true,
      missingSections: [],
      missingKeywords: [],
    });
  });

  it('extracts symbols from direct input and natural language query', () => {
    expect(extractSymbol({ symbol: '600519' })).toBe('600519');
    expect(extractSymbol({ query: '分析贵州茅台 600519' })).toBe('600519');
  });

  it('requires sector summary, candidates, tail-entry sections, and disclaimer', () => {
    const result = checkSectorScreenQuality({
      rotationSummary: [
        '## 市场主线判断',
        '## 明日板块预判',
        '## 尾盘参考标的',
        '免责声明：本内容不构成投资建议。',
      ].join('\n\n'),
      sectors: [{ name: '人工智能' }],
      candidates: [{ symbol: '000001' }],
      tailEntryOutlook: { tradeDate: '2026-06-23' },
    });

    expect(result.passed).toBe(true);
    expect(result.missingSections).toEqual([]);
    expect(result.missingKeywords).toEqual([]);
  });

  it('passes a committee memo with required sections and disclaimer', () => {
    const memo = [
      '## 候选池概览',
      '## 各维度共识',
      '## 分歧与待核实',
      '## 操作建议',
      '## K线信号解读',
      '## 免责声明',
      '本内容不构成投资建议。',
    ].join('\n\n');

    expect(checkCommitteeQuality(memo)).toEqual({
      passed: true,
      missingSections: [],
      missingKeywords: [],
    });
  });
});
