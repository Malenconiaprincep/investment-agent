import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DATA_DIR, PACKAGE_ROOT } from '../../mastra/config/paths.js';
import {
  buildWorkSummaryReport,
  type WorkSummaryReport,
} from '../work-summary/summary.js';
import {
  listWorkSummaryRuns,
  saveWorkSummaryRun,
  type WorkSummaryRunRecord,
  type WorkSummaryRunSummary,
} from '../work-summary/store.js';
import { listBacktestRuns, type BacktestRunRecord } from '../backtest/store.js';
import {
  readRecentScheduledTaskLogs,
  type ScheduledTaskLogEntry,
} from '../schedulers/scheduled-task-log.js';

export const DAILY_WIKI_SCHEMA_VERSION = 1;

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const DAILY_INDEX_LIMIT = 120;

type DailyWikiVerdict = 'improved' | 'worse' | 'flat' | 'unknown';

export type DailyWikiWorkSummarySnapshot = {
  id: string | null;
  generatedAt: string;
  createdAt: string | null;
  overallScore: number;
  grade: WorkSummaryReport['score']['grade'];
  paperReturnPct: number | null;
  backtestAvgReturnPct: number | null;
  riskScore: number;
  coverageScore: number;
  validationScore: number;
  iterationScore: number;
  urgentAlerts: number;
  unacknowledgedAlerts: number;
};

export type DailyWikiComparison = {
  previous: WorkSummaryRunSummary | null;
  scoreDelta: number | null;
  paperReturnDeltaPct: number | null;
  riskScoreDelta: number | null;
  coverageScoreDelta: number | null;
  verdict: DailyWikiVerdict;
};

export type DailyWikiTaskSummary = {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  disabled: number;
};

export type DailyWikiDataUpdate = {
  label: string;
  assetType: string | null;
  mode: string | null;
  tradeDate: string | null;
  ranAt: string | null;
  status: 'completed' | 'partial' | 'failed' | 'skipped' | 'unknown';
  summary: string;
  symbolCount: number | null;
  addedRows: number | null;
  updatedRows: number | null;
  errors: number | null;
  sourceLatestTradeDate: string | null;
  targetLatestTradeDate: string | null;
  reason: string | null;
};

export type DailyWikiDocLink = {
  title: string;
  file: string;
  path: string;
  relativeLink: string;
  updatedAt: string;
};

export type DailyWikiBacktestSummary = {
  recentRuns: BacktestRunRecord[];
  docs: DailyWikiDocLink[];
};

export type DailyWikiReport = {
  schemaVersion: typeof DAILY_WIKI_SCHEMA_VERSION;
  date: string;
  generatedAt: string;
  timeZone: typeof BEIJING_TIME_ZONE;
  paths: {
    repoRoot: string;
    dataDir: string;
    markdown: string;
    json: string;
  };
  workSummary: {
    current: DailyWikiWorkSummarySnapshot;
    comparison: DailyWikiComparison;
    conclusion: string;
    components: WorkSummaryReport['score']['components'];
    coverageSources: WorkSummaryReport['coverage']['sources'];
    performance: WorkSummaryReport['performance'];
    risk: WorkSummaryReport['risk'];
    loop: WorkSummaryReport['loop'];
    strategyHealth: WorkSummaryReport['strategyHealth'];
    optimizationQueue: string[];
    focus: {
      daily: string[];
      weekly: string[];
      monthly: string[];
    };
    eval: {
      ranAt: string;
      passRate: number;
      suiteCount: number;
      failureCount: number;
    } | null;
  };
  scheduledTasks: {
    summary: DailyWikiTaskSummary;
    entries: ScheduledTaskLogEntry[];
  };
  dataUpdates: DailyWikiDataUpdate[];
  changesets: DailyWikiDocLink[];
  backtests: DailyWikiBacktestSummary;
  observations: string[];
  nextActions: string[];
  llmNotes: string[];
};

export type DailyWikiManifestEntry = {
  date: string;
  generatedAt: string;
  markdownPath: string;
  jsonPath: string;
  overallScore: number;
  grade: WorkSummaryReport['score']['grade'];
  paperReturnPct: number | null;
  riskScore: number;
  taskFailures: number;
};

export type DailyWikiManifest = {
  schemaVersion: typeof DAILY_WIKI_SCHEMA_VERSION;
  updatedAt: string;
  latest: DailyWikiManifestEntry | null;
  reportCount: number;
  reports: DailyWikiManifestEntry[];
};

export type DailyWikiOutputPaths = {
  wikiRoot: string;
  dailyDir: string;
  topicsDir: string;
  markdownPath: string;
  jsonPath: string;
  dailyIndexPath: string;
  manifestPath: string;
};

export type DailyWikiGenerationOptions = {
  date?: string;
  now?: Date;
  repoRoot?: string;
  writeFiles?: boolean;
  persistWorkSummary?: boolean;
};

export type DailyWikiGenerationResult = {
  report: DailyWikiReport;
  markdown: string;
  manifest: DailyWikiManifest | null;
  paths: DailyWikiOutputPaths;
};

type JsonObject = Record<string, unknown>;

function resolveRepoRoot(explicitRoot?: string): string {
  if (explicitRoot) return path.resolve(explicitRoot);

  let dir = PACKAGE_ROOT;
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      existsSync(path.join(dir, 'docs'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.resolve(PACKAGE_ROOT, '../..');
}

function formatDateKeyInBeijing(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('无法格式化北京时间日期');
  }
  return `${year}-${month}-${day}`;
}

function dateKeyFromIsoInBeijing(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return null;
  return formatDateKeyInBeijing(time);
}

function assertDateKey(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`日报日期必须是 YYYY-MM-DD: ${date}`);
  }
  return date;
}

function resolveOutputPaths(repoRoot: string, date: string): DailyWikiOutputPaths {
  const wikiRoot = path.join(repoRoot, 'docs/wiki');
  const dailyDir = path.join(wikiRoot, 'daily');
  return {
    wikiRoot,
    dailyDir,
    topicsDir: path.join(wikiRoot, 'topics'),
    markdownPath: path.join(dailyDir, `${date}.md`),
    jsonPath: path.join(dailyDir, `${date}.json`),
    dailyIndexPath: path.join(dailyDir, 'index.md'),
    manifestPath: path.join(wikiRoot, 'manifest.json'),
  };
}

function repoRelative(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function markdownRelative(fromFile: string, targetFile: string): string {
  const relative = path.relative(path.dirname(fromFile), targetFile).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function componentScore(report: WorkSummaryReport, key: string): number {
  return report.score.components.find((component) => component.key === key)?.score ?? 0;
}

function snapshotFromSaved(saved: WorkSummaryRunRecord): DailyWikiWorkSummarySnapshot {
  return {
    id: saved.id,
    generatedAt: saved.generatedAt,
    createdAt: saved.createdAt,
    overallScore: saved.overallScore,
    grade: saved.grade,
    paperReturnPct: saved.paperReturnPct,
    backtestAvgReturnPct: saved.backtestAvgReturnPct,
    riskScore: saved.riskScore,
    coverageScore: saved.coverageScore,
    validationScore: saved.validationScore,
    iterationScore: saved.iterationScore,
    urgentAlerts: saved.urgentAlerts,
    unacknowledgedAlerts: saved.unacknowledgedAlerts,
  };
}

function snapshotFromReport(report: WorkSummaryReport): DailyWikiWorkSummarySnapshot {
  return {
    id: null,
    generatedAt: report.generatedAt,
    createdAt: null,
    overallScore: report.score.overall,
    grade: report.score.grade,
    paperReturnPct: report.performance.paperReturnPct,
    backtestAvgReturnPct: report.performance.backtestAvgReturnPct,
    riskScore: report.risk.score,
    coverageScore: report.coverage.score,
    validationScore: componentScore(report, 'validation'),
    iterationScore: componentScore(report, 'iteration'),
    urgentAlerts: report.risk.urgentAlerts,
    unacknowledgedAlerts: report.risk.unacknowledgedAlerts,
  };
}

function deltaNumber(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return Number((current - previous).toFixed(2));
}

function compareWorkSummary(
  current: DailyWikiWorkSummarySnapshot,
  previous: WorkSummaryRunSummary | null,
): DailyWikiComparison {
  if (!previous) {
    return {
      previous: null,
      scoreDelta: null,
      paperReturnDeltaPct: null,
      riskScoreDelta: null,
      coverageScoreDelta: null,
      verdict: 'unknown',
    };
  }

  const scoreDelta = deltaNumber(current.overallScore, previous.overallScore);
  const paperReturnDeltaPct = deltaNumber(
    current.paperReturnPct,
    previous.paperReturnPct,
  );
  const riskScoreDelta = deltaNumber(current.riskScore, previous.riskScore);
  const coverageScoreDelta = deltaNumber(
    current.coverageScore,
    previous.coverageScore,
  );
  const compositeDelta =
    (scoreDelta ?? 0) +
    (riskScoreDelta ?? 0) * 0.4 +
    (paperReturnDeltaPct ?? 0) * 3;

  return {
    previous,
    scoreDelta,
    paperReturnDeltaPct,
    riskScoreDelta,
    coverageScoreDelta,
    verdict:
      compositeDelta > 1 ? 'improved' : compositeDelta < -1 ? 'worse' : 'flat',
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readJsonLines(filePath: string): JsonObject[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as JsonObject;
      } catch {
        return null;
      }
    })
    .filter((item): item is JsonObject => item != null);
}

function dataUpdateStatus(row: JsonObject): DailyWikiDataUpdate['status'] {
  const skipped = row.skipped === true;
  const errors = toNumber(row.errors);
  const symbolCount = toNumber(row.symbolCount);
  if (skipped) return 'skipped';
  if (errors != null && symbolCount != null && symbolCount > 0 && errors >= symbolCount) {
    return 'failed';
  }
  if (errors != null && errors > 0) return 'partial';
  if (toStringOrNull(row.ranAt)) return 'completed';
  return 'unknown';
}

function summarizeDataUpdate(row: JsonObject): string {
  const mode = toStringOrNull(row.mode);
  const skipped = row.skipped === true;
  if (mode === 'baidu-market-sync') {
    if (skipped) {
      return `源数据未更新：源 ${toStringOrNull(row.sourceLatestTradeDate) ?? '-'} · 当前 ${
        toStringOrNull(row.targetLatestTradeDate) ?? '-'
      }`;
    }
    return `百度网盘同步：导入 ${toNumber(row.importedStockCsvFiles) ?? 0} 只 · 最新 ${
      toStringOrNull(row.sourceLatestTradeDate) ?? '-'
    }`;
  }

  return `标的 ${toNumber(row.symbolCount) ?? 0} 只 · 新增 ${
    toNumber(row.addedRows) ?? 0
  } 行 · 修正 ${toNumber(row.updatedRows) ?? 0} 行 · 失败 ${
    toNumber(row.errors) ?? 0
  } 只`;
}

function readDailyDataUpdates(date: string): DailyWikiDataUpdate[] {
  const rows = readJsonLines(path.join(DATA_DIR, 'daily-csv-update.log'));
  return rows
    .filter((row) => {
      const tradeDate = toStringOrNull(row.tradeDate);
      const ranAtDate = dateKeyFromIsoInBeijing(toStringOrNull(row.ranAt));
      return tradeDate === date || ranAtDate === date;
    })
    .map((row) => ({
      label: toStringOrNull(row.label) ?? '行情数据更新',
      assetType: toStringOrNull(row.assetType),
      mode: toStringOrNull(row.mode),
      tradeDate: toStringOrNull(row.tradeDate),
      ranAt: toStringOrNull(row.ranAt),
      status: dataUpdateStatus(row),
      summary: summarizeDataUpdate(row),
      symbolCount: toNumber(row.symbolCount),
      addedRows: toNumber(row.addedRows),
      updatedRows: toNumber(row.updatedRows),
      errors: toNumber(row.errors),
      sourceLatestTradeDate: toStringOrNull(row.sourceLatestTradeDate),
      targetLatestTradeDate: toStringOrNull(row.targetLatestTradeDate),
      reason: toStringOrNull(row.reason),
    }))
    .sort((a, b) => (a.ranAt ?? '').localeCompare(b.ranAt ?? ''));
}

function firstMarkdownHeading(content: string, fallback: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;
}

function readDocsForDate(input: {
  repoRoot: string;
  markdownPath: string;
  dir: string;
  date: string;
  filenameMode: 'startsWith' | 'includes';
}): DailyWikiDocLink[] {
  if (!existsSync(input.dir)) return [];

  return readdirSync(input.dir)
    .filter((file) => file.endsWith('.md'))
    .filter((file) =>
      input.filenameMode === 'startsWith'
        ? file.startsWith(input.date)
        : file.includes(input.date),
    )
    .map((file) => {
      const filePath = path.join(input.dir, file);
      const content = readFileSync(filePath, 'utf-8');
      return {
        title: firstMarkdownHeading(content, file.replace(/\.md$/, '')),
        file,
        path: repoRelative(input.repoRoot, filePath),
        relativeLink: markdownRelative(input.markdownPath, filePath),
        updatedAt: statSync(filePath).mtime.toISOString(),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function readBacktestsForDate(date: string, runs: BacktestRunRecord[]): BacktestRunRecord[] {
  return runs
    .filter((run) => dateKeyFromIsoInBeijing(run.createdAt) === date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
}

function summarizeTasks(entries: ScheduledTaskLogEntry[]): DailyWikiTaskSummary {
  return {
    total: entries.length,
    completed: entries.filter((entry) => entry.status === 'completed').length,
    skipped: entries.filter((entry) => entry.status === 'skipped').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
    disabled: entries.filter((entry) => entry.status === 'disabled').length,
  };
}

function buildObservations(input: {
  report: WorkSummaryReport;
  current: DailyWikiWorkSummarySnapshot;
  comparison: DailyWikiComparison;
  taskSummary: DailyWikiTaskSummary;
  dataUpdates: DailyWikiDataUpdate[];
  changesets: DailyWikiDocLink[];
  backtestRuns: BacktestRunRecord[];
}): string[] {
  const observations = [
    input.report.conclusion,
    `系统评分 ${input.current.overallScore}/${input.current.grade}，风险分 ${input.current.riskScore}，数据闭环分 ${input.current.coverageScore}。`,
  ];

  if (input.comparison.verdict !== 'unknown') {
    const label =
      input.comparison.verdict === 'improved'
        ? '改善'
        : input.comparison.verdict === 'worse'
          ? '走弱'
          : '基本持平';
    observations.push(
      `相对上一份工作总结${label}：总分 ${
        input.comparison.scoreDelta == null ? '-' : signed(input.comparison.scoreDelta)
      }，模拟盘收益 ${
        input.comparison.paperReturnDeltaPct == null
          ? '-'
          : signed(input.comparison.paperReturnDeltaPct)
      }pct。`,
    );
  }

  if (input.taskSummary.failed > 0) {
    observations.push(`今日有 ${input.taskSummary.failed} 个定时任务失败，需要优先排查。`);
  } else if (input.taskSummary.total > 0) {
    observations.push(
      `定时任务记录 ${input.taskSummary.total} 条，完成 ${input.taskSummary.completed} 条，跳过 ${input.taskSummary.skipped} 条。`,
    );
  }

  const dataFailures = input.dataUpdates.filter(
    (item) => item.status === 'failed' || item.status === 'partial',
  );
  if (dataFailures.length > 0) {
    observations.push(`行情数据更新存在 ${dataFailures.length} 条失败或部分失败记录。`);
  }

  if (input.changesets.length > 0) {
    observations.push(`今日新增 ${input.changesets.length} 条 changeset，可用于后续复盘验证。`);
  }

  if (input.backtestRuns.length > 0) {
    const positive = input.backtestRuns.filter(
      (run) => (run.finalReturnPct ?? Number.NEGATIVE_INFINITY) > 0,
    ).length;
    observations.push(`今日新增回测记录 ${input.backtestRuns.length} 条，正收益 ${positive} 条。`);
  }

  return observations.slice(0, 8);
}

function buildNextActions(report: WorkSummaryReport, taskSummary: DailyWikiTaskSummary): string[] {
  const actions = [...report.optimizationQueue, ...report.dailyFocus];
  if (taskSummary.failed > 0) {
    actions.unshift('先处理失败定时任务，确认数据获取、模拟盘和通知链路没有断点。');
  }
  return [...new Set(actions)].slice(0, 8);
}

function buildLlmNotes(report: WorkSummaryReport): string[] {
  return [
    '日报记录当天事实，不直接替代策略结论；周报/月报应继续对比多日样本。',
    '复盘策略改动时，优先把 changeset 的预期影响与本日报的实际指标变化对齐。',
    `下一次 Wiki 提炼重点：${report.weeklyFocus[0] ?? '按策略来源统计收益、风险和误报率。'}`,
  ];
}

async function buildDailyWikiReport(
  options: Required<Pick<DailyWikiGenerationOptions, 'date' | 'now' | 'repoRoot'>> &
    Pick<DailyWikiGenerationOptions, 'persistWorkSummary'>,
  outputPaths: DailyWikiOutputPaths,
): Promise<DailyWikiReport> {
  const report = await buildWorkSummaryReport();
  const saved = options.persistWorkSummary
    ? await saveWorkSummaryRun(report)
    : null;
  const current = saved ? snapshotFromSaved(saved) : snapshotFromReport(report);
  const history = await listWorkSummaryRuns(30);
  const previous =
    history.find((run) => (current.id ? run.id !== current.id : true)) ?? null;
  const comparison = compareWorkSummary(current, previous);
  const taskEntries = readRecentScheduledTaskLogs({
    tradeDate: options.date,
    limit: 500,
  });
  const dataUpdates = readDailyDataUpdates(options.date);
  const backtestRuns = await listBacktestRuns(120);
  const todayBacktestRuns = readBacktestsForDate(options.date, backtestRuns);
  const changesets = readDocsForDate({
    repoRoot: options.repoRoot,
    markdownPath: outputPaths.markdownPath,
    dir: path.join(options.repoRoot, 'docs/changesets'),
    date: options.date,
    filenameMode: 'startsWith',
  });
  const backtestDocs = readDocsForDate({
    repoRoot: options.repoRoot,
    markdownPath: outputPaths.markdownPath,
    dir: path.join(options.repoRoot, 'docs/backtests'),
    date: options.date,
    filenameMode: 'includes',
  });
  const taskSummary = summarizeTasks(taskEntries);
  const evalReport = report.evalReport
    ? {
        ranAt: report.evalReport.ranAt,
        passRate: report.evalReport.passRate,
        suiteCount: report.evalReport.suites.length,
        failureCount: report.evalReport.failures.length,
      }
    : null;

  return {
    schemaVersion: DAILY_WIKI_SCHEMA_VERSION,
    date: options.date,
    generatedAt: options.now.toISOString(),
    timeZone: BEIJING_TIME_ZONE,
    paths: {
      repoRoot: options.repoRoot,
      dataDir: DATA_DIR,
      markdown: repoRelative(options.repoRoot, outputPaths.markdownPath),
      json: repoRelative(options.repoRoot, outputPaths.jsonPath),
    },
    workSummary: {
      current,
      comparison,
      conclusion: report.conclusion,
      components: report.score.components,
      coverageSources: report.coverage.sources,
      performance: report.performance,
      risk: report.risk,
      loop: report.loop,
      strategyHealth: report.strategyHealth,
      optimizationQueue: report.optimizationQueue,
      focus: {
        daily: report.dailyFocus,
        weekly: report.weeklyFocus,
        monthly: report.monthlyFocus,
      },
      eval: evalReport,
    },
    scheduledTasks: {
      summary: taskSummary,
      entries: taskEntries,
    },
    dataUpdates,
    changesets,
    backtests: {
      recentRuns: todayBacktestRuns,
      docs: backtestDocs,
    },
    observations: buildObservations({
      report,
      current,
      comparison,
      taskSummary,
      dataUpdates,
      changesets,
      backtestRuns: todayBacktestRuns,
    }),
    nextActions: buildNextActions(report, taskSummary),
    llmNotes: buildLlmNotes(report),
  };
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function formatPct(value: number | null): string {
  if (value == null) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMoney(value: number | null): string {
  if (value == null) return '-';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatIso(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function escapeTable(value: unknown): string {
  return String(value ?? '-').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderTable(headers: string[], rows: Array<Array<unknown>>): string {
  if (rows.length === 0) return '_暂无记录。_';
  return [
    `| ${headers.map(escapeTable).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeTable).join(' | ')} |`),
  ].join('\n');
}

function renderBulletList(items: string[]): string {
  if (items.length === 0) return '- 暂无。';
  return items.map((item) => `- ${item}`).join('\n');
}

function renderDocLinks(items: DailyWikiDocLink[]): string {
  if (items.length === 0) return '- 暂无。';
  return items.map((item) => `- [${item.title}](${item.relativeLink})`).join('\n');
}

function renderTaskStatus(status: ScheduledTaskLogEntry['status']): string {
  if (status === 'completed') return '完成';
  if (status === 'skipped') return '跳过';
  if (status === 'failed') return '失败';
  return '关闭';
}

function renderTaskGroups(entries: ScheduledTaskLogEntry[]): string {
  const groups = new Map<
    string,
    {
      label: string;
      completed: number;
      skipped: number;
      failed: number;
      disabled: number;
      latest: ScheduledTaskLogEntry;
    }
  >();

  for (const entry of entries) {
    const existing = groups.get(entry.taskId);
    if (!existing) {
      groups.set(entry.taskId, {
        label: entry.label,
        completed: entry.status === 'completed' ? 1 : 0,
        skipped: entry.status === 'skipped' ? 1 : 0,
        failed: entry.status === 'failed' ? 1 : 0,
        disabled: entry.status === 'disabled' ? 1 : 0,
        latest: entry,
      });
      continue;
    }

    existing.completed += entry.status === 'completed' ? 1 : 0;
    existing.skipped += entry.status === 'skipped' ? 1 : 0;
    existing.failed += entry.status === 'failed' ? 1 : 0;
    existing.disabled += entry.status === 'disabled' ? 1 : 0;
    if (entry.ranAt.localeCompare(existing.latest.ranAt) > 0) {
      existing.latest = entry;
    }
  }

  const rows = [...groups.values()]
    .sort((a, b) => b.latest.ranAt.localeCompare(a.latest.ranAt))
    .map((group) => [
      group.label,
      group.completed,
      group.skipped,
      group.failed,
      group.disabled,
      group.latest.ranAtBeijing,
      group.latest.summary ?? group.latest.reason ?? '-',
    ]);

  return renderTable(['任务', '完成', '跳过', '失败', '关闭', '最新时间', '最近摘要'], rows);
}

function renderDataStatus(status: DailyWikiDataUpdate['status']): string {
  if (status === 'completed') return '完成';
  if (status === 'partial') return '部分失败';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '跳过';
  return '未知';
}

function renderVerdict(verdict: DailyWikiVerdict): string {
  if (verdict === 'improved') return '改善';
  if (verdict === 'worse') return '走弱';
  if (verdict === 'flat') return '持平';
  return '无前序样本';
}

export function renderDailyWikiMarkdown(report: DailyWikiReport): string {
  const current = report.workSummary.current;
  const comparison = report.workSummary.comparison;
  const taskSummary = report.scheduledTasks.summary;
  const recentTaskEntries = report.scheduledTasks.entries.slice(0, 60);

  return `---
title: "投研日报 ${report.date}"
date: "${report.date}"
generated_at: "${report.generatedAt}"
schema_version: ${report.schemaVersion}
time_zone: "${report.timeZone}"
tags:
  - daily-report
  - investment-agent
  - llm-wiki
---

# 投研日报 ${report.date}

> 本文档由投研 Agent 自动生成，是日级事实账本。策略结论以多日复盘和回测验证为准。

## 今日结论

${renderBulletList(report.observations)}

## 系统评分

| 指标 | 数值 |
| --- | ---: |
| 总分 | ${current.overallScore} / 100 |
| 评级 | ${current.grade} |
| 相对上一份 | ${renderVerdict(comparison.verdict)} |
| 总分变化 | ${comparison.scoreDelta == null ? '-' : signed(comparison.scoreDelta)} |
| 模拟盘收益变化 | ${
    comparison.paperReturnDeltaPct == null
      ? '-'
      : `${signed(comparison.paperReturnDeltaPct)} pct`
  } |
| 风险分变化 | ${
    comparison.riskScoreDelta == null ? '-' : signed(comparison.riskScoreDelta)
  } |

${renderTable(
  ['维度', '分数', '说明'],
  report.workSummary.components.map((component) => [
    component.label,
    component.score,
    component.detail,
  ]),
)}

## 数据闭环

${renderTable(
  ['数据源', '数量', '最新时间', '状态'],
  report.workSummary.coverageSources.map((source) => [
    source.label,
    source.count,
    formatIso(source.latestAt),
    source.status === 'good' ? '有效' : source.status === 'stale' ? '过期' : '为空',
  ]),
)}

## 数据获取与任务运行

| 指标 | 数量 |
| --- | ---: |
| 任务记录 | ${taskSummary.total} |
| 完成 | ${taskSummary.completed} |
| 跳过 | ${taskSummary.skipped} |
| 失败 | ${taskSummary.failed} |
| 关闭 | ${taskSummary.disabled} |

${renderTaskGroups(report.scheduledTasks.entries)}

### 最近任务记录

${renderTable(
  ['时间', '任务', '状态', '摘要/原因'],
  recentTaskEntries.map((entry) => [
    entry.ranAtBeijing,
    entry.label,
    renderTaskStatus(entry.status),
    entry.summary ?? entry.reason ?? '-',
  ]),
)}

${
  report.scheduledTasks.entries.length > recentTaskEntries.length
    ? `_Markdown 仅展示最近 ${recentTaskEntries.length} 条；完整任务日志见 JSON sidecar。_`
    : ''
}

### 行情数据更新

${renderTable(
  ['时间', '任务', '资产', '状态', '摘要'],
  report.dataUpdates.map((item) => [
    formatIso(item.ranAt),
    item.label,
    item.assetType ?? '-',
    renderDataStatus(item.status),
    item.summary,
  ]),
)}

## 模拟盘与风险

| 指标 | 数值 |
| --- | ---: |
| 模拟盘收益 | ${formatPct(report.workSummary.performance.paperReturnPct)} |
| 模拟盘总资产 | ${formatMoney(report.workSummary.performance.paperTotalValue)} |
| 初始资金 | ${formatMoney(report.workSummary.performance.paperInitialCash)} |
| 权益趋势 | ${report.workSummary.performance.equityTrend} |
| 当前持仓数 | ${report.workSummary.risk.openPositionCount} |
| 仓位 | ${formatPct(report.workSummary.risk.exposurePct)} |
| 紧急告警 | ${report.workSummary.risk.urgentAlerts} |
| 未确认告警 | ${report.workSummary.risk.unacknowledgedAlerts} |
| 最差跟踪收益 | ${formatPct(report.workSummary.risk.worstWatchlistReturnPct)} |

## 回测与验证

| 指标 | 数值 |
| --- | ---: |
| 回测均值 | ${formatPct(report.workSummary.performance.backtestAvgReturnPct)} |
| 正收益回测 | ${report.workSummary.performance.profitableBacktestCount} / ${
    report.workSummary.performance.backtestCount
  } |
| 今日新增回测 | ${report.backtests.recentRuns.length} |
| Eval 通过率 | ${
    report.workSummary.eval ? formatPct(report.workSummary.eval.passRate) : '-'
  } |
| Eval 失败项 | ${report.workSummary.eval?.failureCount ?? '-'} |

${renderTable(
  ['创建时间', '策略', '资产', '区间', '交易', '收益', 'runId'],
  report.backtests.recentRuns.map((run) => [
    formatIso(run.createdAt),
    run.strategy,
    run.assetType,
    `${run.startDate ?? '-'} ~ ${run.endDate ?? '-'}`,
    run.tradeCount,
    formatPct(run.finalReturnPct),
    run.id,
  ]),
)}

### 回测文档

${renderDocLinks(report.backtests.docs)}

## 策略闭环健康

${renderTable(
  ['环节', '分数', '状态', '结论', '细节'],
  report.workSummary.loop.map((step) => [
    step.label,
    step.score,
    step.status,
    step.headline,
    step.detail,
  ]),
)}

## 策略模块观察

${renderTable(
  ['模块', '分数', '状态', '证据', '建议'],
  report.workSummary.strategyHealth.map((item) => [
    item.label,
    item.score,
    item.status,
    item.evidence,
    item.suggestion,
  ]),
)}

## 今日 Changesets

${renderDocLinks(report.changesets)}

## 下一步动作

${renderBulletList(report.nextActions)}

## LLM 复盘提示

${renderBulletList(report.llmNotes)}

## 关联知识

- [Wiki 索引](../README.md)
- [回测方法论](../topics/backtesting.md)
- 机器可读 sidecar：[${path.basename(report.paths.json)}](./${path.basename(
    report.paths.json,
  )})
`;
}

function manifestEntryFromReport(report: DailyWikiReport): DailyWikiManifestEntry {
  return {
    date: report.date,
    generatedAt: report.generatedAt,
    markdownPath: report.paths.markdown,
    jsonPath: report.paths.json,
    overallScore: report.workSummary.current.overallScore,
    grade: report.workSummary.current.grade,
    paperReturnPct: report.workSummary.performance.paperReturnPct,
    riskScore: report.workSummary.risk.score,
    taskFailures: report.scheduledTasks.summary.failed,
  };
}

function parseReportFile(filePath: string): DailyWikiReport | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as DailyWikiReport;
    if (parsed.schemaVersion !== DAILY_WIKI_SCHEMA_VERSION || !parsed.date) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildDailyWikiManifest(
  dailyDir: string,
  updatedAt: string,
): DailyWikiManifest {
  const reports = existsSync(dailyDir)
    ? readdirSync(dailyDir)
        .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
        .map((file) => parseReportFile(path.join(dailyDir, file)))
        .filter((report): report is DailyWikiReport => report != null)
        .map(manifestEntryFromReport)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  return {
    schemaVersion: DAILY_WIKI_SCHEMA_VERSION,
    updatedAt,
    latest: reports[0] ?? null,
    reportCount: reports.length,
    reports,
  };
}

function renderDailyIndex(manifest: DailyWikiManifest): string {
  const rows = manifest.reports.slice(0, DAILY_INDEX_LIMIT).map((entry) => [
    entry.date,
    `[日报](./${entry.date}.md) / [JSON](./${entry.date}.json)`,
    `${entry.overallScore} (${entry.grade})`,
    formatPct(entry.paperReturnPct),
    entry.riskScore,
    entry.taskFailures,
  ]);

  return `# 每日日报索引

- 更新时间：${manifest.updatedAt}
- 报告数量：${manifest.reportCount}
- 最新日报：${
    manifest.latest ? `[${manifest.latest.date}](./${manifest.latest.date}.md)` : '暂无'
  }

${renderTable(['日期', '文件', '评分', '模拟盘收益', '风险分', '任务失败'], rows)}
`;
}

function writeFileAtomic(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, 'utf-8');
  renameSync(tempPath, filePath);
}

export async function generateDailyWikiReport(
  options: DailyWikiGenerationOptions = {},
): Promise<DailyWikiGenerationResult> {
  const now = options.now ?? new Date();
  const date = assertDateKey(options.date ?? formatDateKeyInBeijing(now));
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const writeFiles = options.writeFiles ?? true;
  const persistWorkSummary = options.persistWorkSummary ?? writeFiles;
  const paths = resolveOutputPaths(repoRoot, date);
  const report = await buildDailyWikiReport(
    { date, now, repoRoot, persistWorkSummary },
    paths,
  );
  const markdown = renderDailyWikiMarkdown(report);

  if (!writeFiles) {
    return { report, markdown, manifest: null, paths };
  }

  mkdirSync(paths.dailyDir, { recursive: true });
  mkdirSync(paths.topicsDir, { recursive: true });
  writeFileAtomic(paths.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileAtomic(paths.markdownPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`);

  const manifest = buildDailyWikiManifest(paths.dailyDir, now.toISOString());
  writeFileAtomic(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileAtomic(paths.dailyIndexPath, renderDailyIndex(manifest));

  return { report, markdown, manifest, paths };
}

export function getDailyWikiPaths(options?: {
  date?: string;
  repoRoot?: string;
}): DailyWikiOutputPaths {
  const date = assertDateKey(options?.date ?? formatDateKeyInBeijing(new Date()));
  return resolveOutputPaths(resolveRepoRoot(options?.repoRoot), date);
}
