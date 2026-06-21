type QualityKind = 'report' | 'screen' | 'committee';

const LABELS: Record<QualityKind, { ok: string; warn: string }> = {
  report: { ok: '报告完整', warn: '待完善' },
  screen: { ok: '已完成', warn: '待完善' },
  committee: { ok: '分析完成', warn: '待完善' },
};

type QualityBadgeProps = {
  passed: boolean;
  kind: QualityKind;
};

export function QualityBadge({ passed, kind }: QualityBadgeProps) {
  const text = passed ? LABELS[kind].ok : LABELS[kind].warn;
  return (
    <span className={`badge ${passed ? 'pass' : 'fail'}`}>{text}</span>
  );
}

export function formatMissingHint(
  missingSections: string[],
  missingKeywords: string[] = [],
) {
  const parts: string[] = [];
  if (missingSections.length > 0) {
    parts.push(`缺少章节：${missingSections.join('、')}`);
  }
  if (missingKeywords.length > 0) {
    parts.push(`缺少要点：${missingKeywords.join('、')}`);
  }
  return parts.join(' · ');
}
