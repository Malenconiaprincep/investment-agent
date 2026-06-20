export const REQUIRED_SECTIONS = [
  '公司概况',
  '行情快照',
  '财务指标',
  '数据来源',
  '风险提示',
  '免责声明',
] as const;

export const REQUIRED_KEYWORDS = ['不构成'] as const;

export type QualityResult = {
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
};

export function checkReportQuality(report: string): QualityResult {
  const missingSections = REQUIRED_SECTIONS.filter(
    (section) => !report.includes(section),
  );
  const missingKeywords = REQUIRED_KEYWORDS.filter(
    (keyword) => !report.toLowerCase().includes(keyword.toLowerCase()),
  );

  return {
    passed: missingSections.length === 0 && missingKeywords.length === 0,
    missingSections,
    missingKeywords,
  };
}

export function extractSymbol(input: {
  symbol?: string;
  query?: string;
}): string {
  if (input.symbol?.trim()) {
    const digits = input.symbol.replace(/\D/g, '');
    if (/^\d{6}$/.test(digits)) return digits;
    return input.symbol.trim();
  }

  const match = input.query?.match(/\b(\d{6})\b/);
  if (match) return match[1];

  throw new Error('请提供 6 位股票代码（symbol）或包含代码的问题（query）');
}
