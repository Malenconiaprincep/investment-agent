const REQUIRED_DISCLAIMER = '不构成投资建议';

export function checkSectorScreenQuality(output: {
  rotationSummary: string;
  sectors: unknown[];
  candidates: unknown[];
  tailEntryOutlook?: unknown | null;
  asOfDate?: string;
}): {
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
} {
  const missingSections: string[] = [];
  const missingKeywords: string[] = [];

  if (
    !output.rotationSummary.includes('## 板块轮动逻辑') &&
    !output.rotationSummary.includes('## 市场主线判断')
  ) {
    missingSections.push('市场主线判断');
  }
  if (output.sectors.length === 0 && output.candidates.length === 0) {
    missingSections.push('板块或候选股');
  }
  if (
    !output.asOfDate &&
    output.tailEntryOutlook &&
    !output.rotationSummary.includes('## 明日板块预判')
  ) {
    missingSections.push('明日板块预判');
  }
  if (
    !output.asOfDate &&
    output.tailEntryOutlook &&
    !output.rotationSummary.includes('## 尾盘参考标的')
  ) {
    missingSections.push('尾盘参考标的');
  }
  if (!output.rotationSummary.includes(REQUIRED_DISCLAIMER)) {
    missingKeywords.push(REQUIRED_DISCLAIMER);
  }

  return {
    passed: missingSections.length === 0 && missingKeywords.length === 0,
    missingSections,
    missingKeywords,
  };
}
