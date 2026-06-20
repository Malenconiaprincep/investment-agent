const REQUIRED_SECTIONS = [
  '候选池概览',
  '各维度共识',
  '分歧与待核实',
  '免责声明',
];

export function checkCommitteeQuality(memo: string): {
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
} {
  const missingSections = REQUIRED_SECTIONS.filter(
    (section) => !memo.includes(section),
  );
  const missingKeywords: string[] = [];
  if (!memo.includes('不构成投资建议')) {
    missingKeywords.push('不构成投资建议');
  }

  return {
    passed: missingSections.length === 0 && missingKeywords.length === 0,
    missingSections,
    missingKeywords,
  };
}
