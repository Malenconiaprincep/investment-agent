import type { ScreenStreamEvent, ScreeningStreamCandidate } from '../../api/screen-stream-types.js';
import {
  runDataQualityHarness,
  type DataQualityHarnessReport,
} from '../../eval/data-quality-harness.js';
import { notifyFeishuPostSafe } from '../notify/feishu.js';
import { formatTradeDate, getBeijingNow } from '../paper/trading-calendar.js';
import {
  buildMorningBriefingContext,
  buildMorningBriefingLines,
  buildMorningBriefingScreeningQuery,
  evaluateMorningBriefingQuality,
  type MorningBriefingContext,
  type MorningBriefingQualityReport,
} from './morning-briefing.js';

export type PreopenScreeningDoneEvent = Extract<
  ScreenStreamEvent,
  { type: 'done' }
>;

export type PreopenScreeningRunResult = {
  tradeDate: string;
  startedAt: string;
  skipped?: boolean;
  reason?: string;
  dataQuality: DataQualityHarnessReport;
  morningBriefing?: MorningBriefingContext;
  morningBriefingQuality?: MorningBriefingQualityReport;
  screening?: PreopenScreeningDoneEvent;
};

function beijingTimeLabel(date = new Date()): string {
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function truncate(value: string | undefined, maxLength: number): string {
  const text = value?.trim() ?? '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function diamondLabel(candidate: ScreeningStreamCandidate): string {
  if (!candidate.diamond) return '无钻石';
  const color = candidate.diamond.strength === 'red' ? '红钻' : '蓝钻';
  return `${color}${candidate.diamond.score}`;
}

function factorLabel(candidate: ScreeningStreamCandidate): string {
  const factor = candidate.factorScore;
  if (!factor) return '因子-';
  return `因子${factor.total} · ${factor.outlookLabel} · 20/60日 ${formatPct(factor.ret20dPct)}/${formatPct(factor.ret60dPct)}`;
}

function candidateLine(candidate: ScreeningStreamCandidate, index: number): string {
  const assetType = candidate.assetType === 'etf' ? 'ETF' : '股票';
  return `${index + 1}. ${candidate.name}(${candidate.symbol}) · ${assetType} · ${diamondLabel(candidate)} · ${factorLabel(candidate)} · ${truncate(candidate.thesis, 42)}`;
}

function qualityLine(report: DataQualityHarnessReport): string {
  return `数据质量：${report.score} 分 · ${report.summary.pass} pass / ${report.summary.warn} warn / ${report.summary.fail} fail · 最新 ${report.freshness.latestDataDate ?? '未知'}`;
}

export function buildPreopenScreeningLines(input: {
  dataQuality: DataQualityHarnessReport;
  screening: PreopenScreeningDoneEvent;
  morningBriefing?: MorningBriefingContext;
  now?: Date;
}): string[] {
  const { dataQuality, screening } = input;
  if (input.morningBriefing) {
    return buildMorningBriefingLines({
      context: input.morningBriefing,
      screening,
      now: input.now,
    });
  }

  const lines = [
    `时间：${beijingTimeLabel(input.now)}`,
    `交易日：${dataQuality.freshness.tradeDate}`,
    qualityLine(dataQuality),
    `查询：${truncate(screening.query, 90)}`,
  ];

  if (screening.hotThemes.length > 0) {
    lines.push(`热点：${screening.hotThemes.slice(0, 8).join('、')}`);
  }

  if (screening.sectors.length > 0) {
    lines.push(
      `板块：${screening.sectors
        .slice(0, 5)
        .map((sector) => sector.name)
        .join('、')}`,
    );
  }

  lines.push(
    '',
    `候选池：${screening.candidates.length} 只 · 钻石 ${screening.diamondPicks.length} 只 · 入跟踪池 ${screening.watchlistSync?.added.length ?? 0} 只`,
  );

  const candidates = screening.candidates.slice(0, 8);
  if (candidates.length === 0) {
    lines.push('今日没有形成候选池。');
  } else {
    lines.push(...candidates.map(candidateLine));
  }

  if (screening.watchlistSync?.added.length) {
    lines.push(
      '',
      `新增跟踪：${screening.watchlistSync.added
        .slice(0, 6)
        .map((item) => `${item.name}(${item.symbol}) ${item.grade}`)
        .join('、')}`,
    );
  }

  const warnings = [
    ...screening.fetchErrors.slice(0, 3),
    ...screening.missingSections.map((item) => `缺少章节：${item}`).slice(0, 2),
    ...screening.missingKeywords.map((item) => `缺少关键词：${item}`).slice(0, 2),
  ];
  if (warnings.length > 0) {
    lines.push('', '待核实：', ...warnings.map((item) => `· ${truncate(item, 90)}`));
  }

  lines.push('', '口径：盘前候选池仅供研究跟踪，不构成投资建议。');
  return lines;
}

export function buildPreopenDataQualityFailureLines(input: {
  dataQuality: DataQualityHarnessReport;
  morningBriefing?: MorningBriefingContext;
  now?: Date;
}): string[] {
  const failed = input.dataQuality.checks.filter((check) => check.status === 'fail');
  const warned = input.dataQuality.checks.filter((check) => check.status === 'warn');
  const lines = input.morningBriefing
    ? [
        ...buildMorningBriefingLines({
          context: input.morningBriefing,
          now: input.now,
        }),
        '',
        '状态：数据质量未通过，已停止盘前选股，避免用脏数据生成候选池。',
      ]
    : [
        `时间：${beijingTimeLabel(input.now)}`,
        `交易日：${input.dataQuality.freshness.tradeDate}`,
        qualityLine(input.dataQuality),
        '状态：数据质量未通过，已停止盘前选股，避免用脏数据生成候选池。',
      ];

  if (failed.length > 0) {
    lines.push('', '失败项：');
    lines.push(
      ...failed.slice(0, 6).map((check) => `· ${check.label}：${truncate(check.detail, 90)}`),
    );
  }

  if (warned.length > 0) {
    lines.push('', `预警项：${warned.length} 条，见 data-quality harness 详情。`);
  }

  lines.push('', '修复数据后可手动运行：pnpm screen:schedule preopen');
  return lines;
}

export async function notifyPreopenScreening(input: {
  dataQuality: DataQualityHarnessReport;
  morningBriefing?: MorningBriefingContext;
  screening: PreopenScreeningDoneEvent;
}): Promise<void> {
  if (process.env.FEISHU_NOTIFY_PREOPEN_SCREEN === '0') return;
  await notifyFeishuPostSafe(
    '盘前投研早报',
    buildPreopenScreeningLines(input),
  );
}

export async function notifyPreopenDataQualityFailure(
  dataQuality: DataQualityHarnessReport,
  morningBriefing?: MorningBriefingContext,
): Promise<void> {
  if (process.env.FEISHU_NOTIFY_PREOPEN_SCREEN === '0') return;
  await notifyFeishuPostSafe(
    '盘前投研早报数据未就绪',
    buildPreopenDataQualityFailureLines({ dataQuality, morningBriefing }),
  );
}

export async function runPreopenScreeningNotification(input?: {
  maxCandidates?: number;
  lookbackDays?: number;
  notify?: boolean;
  force?: boolean;
  now?: Date;
}): Promise<PreopenScreeningRunResult> {
  const startedAt = new Date().toISOString();
  const now = input?.now ?? getBeijingNow();
  const tradeDate = formatTradeDate(now);
  const dataQuality = runDataQualityHarness({ now });

  if (!dataQuality.freshness.isTradingDay && !input?.force) {
    return {
      tradeDate,
      startedAt,
      skipped: true,
      reason: '非交易日',
      dataQuality,
    };
  }

  const morningBriefing = await buildMorningBriefingContext({
    dataQuality,
    lookbackDays: Math.min(input?.lookbackDays ?? 14, 5),
    now,
  });

  if (!dataQuality.passed && !input?.force) {
    if (input?.notify !== false) {
      await notifyPreopenDataQualityFailure(dataQuality, morningBriefing);
    }
    return {
      tradeDate,
      startedAt,
      skipped: true,
      reason: 'data-quality-failed',
      dataQuality,
      morningBriefing,
      morningBriefingQuality: evaluateMorningBriefingQuality({
        context: morningBriefing,
      }),
    };
  }

  let done: PreopenScreeningDoneEvent | null = null;
  const { runSectorScreenStream } = await import(
    '../../api/run-sector-screen-stream.js'
  );
  await runSectorScreenStream(
    {
      query: buildMorningBriefingScreeningQuery(morningBriefing),
      maxCandidates: input?.maxCandidates ?? 10,
      excludeSt: true,
      includeEtf: true,
      lookbackDays: input?.lookbackDays ?? 14,
    },
    (event) => {
      if (event.type === 'done') {
        done = event;
      }
    },
  );

  if (!done) {
    throw new Error('盘前智能选股未返回完成事件');
  }

  if (input?.notify !== false) {
    await notifyPreopenScreening({
      dataQuality,
      morningBriefing,
      screening: done,
    });
  }

  const morningBriefingQuality = evaluateMorningBriefingQuality({
    context: morningBriefing,
    screening: done,
  });

  return {
    tradeDate,
    startedAt,
    dataQuality,
    morningBriefing,
    morningBriefingQuality,
    screening: done,
  };
}
