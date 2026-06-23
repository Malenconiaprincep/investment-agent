'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { TailEntryOutlookPanel } from '@/components/TailEntryOutlookPanel';
import { CommitteeTradePanel, type CommitteeTradePlanView } from '@/components/CommitteeTradePanel';
import { StockKlineChart } from '@/components/charts/StockKlineChart';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { AddToWatchlistButton } from '@/components/ui/AddToWatchlistButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { QualityBadge } from '@/components/ui/QualityBadge';
import { WorkflowStatus } from '@/components/ui/WorkflowStatus';
import { readSSEStream } from '@/lib/sse';
import {
  extractMarkdownDisclaimer,
  splitMarkdownSections,
} from '@/lib/markdown-sections';
import { resolveTailEntryDisplay } from '@/lib/tail-entry-display';

type Sector = { name: string; reason: string; dataSource: string };
type Candidate = {
  symbol: string;
  name: string;
  thesis: string;
  dataSource: string;
  factorScore?: {
    total: number;
    themeScore: number;
    longTermScore: number;
    trendReturnScore: number;
    stabilityScore: number;
    outlook: 'mainline-trend' | 'long-watch' | 'neutral' | 'weak';
    outlookLabel: string;
    matchedTheme: string | null;
    ret20dPct: number | null;
    ret60dPct: number | null;
    ret120dPct: number | null;
  } | null;
  diamond?: {
    strength: 'red' | 'blue';
    score: number;
    tradeDate: string;
    close: number;
    reasons: string[];
  } | null;
};
type HotNewsItem = { title: string; datetime: string; url: string | null };

type TailEntryOutlook = {
  tradeDate: string;
  nextTradeDate: string;
  sectorPicks: Array<{
    name: string;
    pctChg: number;
    netInflowYi: number;
    priorityStars: number;
    logic: string;
    leaders: Array<{
      symbol: string;
      name: string;
      pctChg: number;
      netInflowWan: number;
      tierLabel: string;
      logic: string;
      riskNote?: string;
    }>;
  }>;
  topInflowStocks: Array<{
    symbol: string;
    name: string;
    pctChg: number;
    netInflowWan: number;
    tierLabel: string;
    logic: string;
    riskNote?: string;
  }>;
  plans: Array<{
    label: string;
    sectors: string[];
    symbols: string[];
    note: string;
  }>;
  watchSignals: string[];
  avoidSectors: Array<{ name: string; reason: string }>;
};

type TailEntryRun = {
  status: 'success' | 'failed' | 'skipped' | 'empty';
  message: string;
  sectorCount: number;
  stockCount: number;
  nextTradeDate?: string;
  ranAt: string;
};

function formatNewsTime(isoOrLocal: string): string {
  const ts = Date.parse(isoOrLocal);
  if (!Number.isFinite(ts)) {
    return isoOrLocal.slice(0, 16);
  }
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCandidateThesis(thesis: string) {
  const parts = thesis.split(/[；;]/).map((p) => p.trim()).filter(Boolean);
  let price: string | undefined;
  let change: string | undefined;

  for (const part of parts) {
    if (part.includes('最新价') || part.includes('现价')) {
      price = part.split(/[:：]/)[1]?.trim();
    }
    if (part.includes('涨跌幅') || part.includes('涨幅')) {
      change = part.split(/[:：]/)[1]?.trim();
    }
  }

  const summary = parts
    .filter(
      (p) =>
        !p.includes('股票代码') &&
        !p.includes('stock_code') &&
        !p.includes('最新价') &&
        !p.includes('涨跌幅'),
    )
    .slice(0, 2)
    .join(' · ');

  return {
    price,
    change,
    summary: summary || thesis.slice(0, 72),
  };
}

type ScreenResult = {
  query: string;
  sectors: Sector[];
  candidates: Candidate[];
  diamondPicks: Candidate[];
  rotationSummary: string;
  hotNews: HotNewsItem[];
  hotThemes: string[];
  mode: 'auto' | 'manual';
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  sessionId?: string;
  elapsedMs: number;
  asOfDate?: string;
  fetchErrors?: string[];
  tailEntryOutlook?: TailEntryOutlook | null;
  tailEntryRun?: TailEntryRun | null;
};

type CommitteeResult = {
  memo: string;
  passed: boolean;
  sessionId?: string;
  elapsedMs: number;
  tradePlans: CommitteeTradePlanView[];
};

type ScreenStreamEvent =
  | { type: 'step'; label: string }
  | { type: 'token'; text: string }
  | {
      type: 'hotNews';
      query: string;
      mode: 'auto' | 'manual';
      hotThemes: string[];
      hotNews: HotNewsItem[];
    }
  | { type: 'sectors'; sectors: Sector[] }
  | { type: 'candidates'; candidates: Candidate[]; diamondPicks: Candidate[] }
  | { type: 'tailEntryOutlook'; outlook: TailEntryOutlook }
  | { type: 'tailEntryRun'; run: TailEntryRun }
  | {
      type: 'done';
      query: string;
      sectors: Sector[];
      candidates: Candidate[];
      diamondPicks: Candidate[];
      rotationSummary: string;
      hotNews: HotNewsItem[];
      hotThemes: string[];
      mode: 'auto' | 'manual';
      passed: boolean;
      missingSections: string[];
      missingKeywords: string[];
      sessionId: string;
      elapsedMs: number;
      asOfDate?: string;
      fetchErrors: string[];
      tailEntryOutlook?: TailEntryOutlook | null;
      tailEntryRun?: TailEntryRun | null;
    }
  | { type: 'error'; message: string };

type CommitteeStreamEvent =
  | { type: 'step'; label: string }
  | { type: 'token'; text: string }
  | { type: 'specialist'; role: string; status: string }
  | { type: 'tradePlans'; tradePlans: CommitteeTradePlanView[] }
  | {
      type: 'done';
      memo: string;
      passed: boolean;
      sessionId: string;
      elapsedMs: number;
      tradePlans: CommitteeTradePlanView[];
    }
  | { type: 'error'; message: string };

const SCREEN_STEPS = [
  '扫描热点',
  '筛选板块',
  '筛选候选股',
  '补充信息',
  '钻石信号检测',
  '因子打分',
  '明日预判',
  '生成摘要',
  '核对结果',
];

const COMMITTEE_STEPS = [
  '整理候选池',
  'K 线信号扫描',
  '多维度分析',
  '综合结论',
  '核对报告',
];

function ScreenPageContent() {
  const searchParams = useSearchParams();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [queryOverride, setQueryOverride] = useState('');
  const [lookbackDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [committeeLoading, setCommitteeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [committeeStep, setCommitteeStep] = useState<string | null>(null);
  const [streamingSummary, setStreamingSummary] = useState('');
  const [streamingMemo, setStreamingMemo] = useState('');
  const [hotNews, setHotNews] = useState<HotNewsItem[]>([]);
  const [autoQuery, setAutoQuery] = useState<string | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [diamondPicks, setDiamondPicks] = useState<Candidate[]>([]);
  const [tailEntryOutlook, setTailEntryOutlook] = useState<TailEntryOutlook | null>(
    null,
  );
  const [tailEntryRun, setTailEntryRun] = useState<TailEntryRun | null>(null);
  const [screenResult, setScreenResult] = useState<ScreenResult | null>(null);
  const [committeeResult, setCommitteeResult] = useState<CommitteeResult | null>(
    null,
  );
  const [tradePlans, setTradePlans] = useState<CommitteeTradePlanView[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResults, setBatchResults] = useState<
    Array<{
      symbol: string;
      name: string;
      passed: boolean;
      reportId?: string;
      error?: string;
    }>
  >([]);

  useEffect(() => {
    const fromUrl = searchParams.get('asOf')?.trim();
    if (fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl)) {
      setError('历史回放暂不可用（问财不支持按日期筛股），已切换为今日智能选股。');
    }
  }, [searchParams]);

  async function handleScreenSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setCommitteeLoading(false);
    setError(null);
    setScreenResult(null);
    setCommitteeResult(null);
    setSectors([]);
    setCandidates([]);
    setDiamondPicks([]);
    setTailEntryOutlook(null);
    setTailEntryRun(null);
    setHotNews([]);
    setAutoQuery(null);
    setStreamingSummary('');
    setStreamingMemo('');
    setCurrentStep(null);

    const trimmedOverride = queryOverride.trim();
    const body: Record<string, unknown> = {
      maxCandidates: 10,
      lookbackDays,
      ...(showAdvanced && trimmedOverride ? { query: trimmedOverride } : {}),
    };

    try {
      const response = await fetch('/api/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data: unknown = await response.json();
        throw new Error((data as { error?: string }).error ?? '请求失败');
      }

      let summary = '';
      let finalResult: ScreenResult | null = null;
      let pendingTailEntryRun: TailEntryRun | null = null;
      let pendingTailEntryOutlook: TailEntryOutlook | null = null;

      await readSSEStream(response, (_eventName, data) => {
        const event = JSON.parse(data) as ScreenStreamEvent;
        if (event.type === 'step') setCurrentStep(event.label);
        if (event.type === 'hotNews') {
          setHotNews(event.hotNews);
          setAutoQuery(event.query);
        }
        if (event.type === 'sectors') setSectors(event.sectors);
        if (event.type === 'candidates') {
          setCandidates(event.candidates);
          setDiamondPicks(event.diamondPicks);
        }
        if (event.type === 'tailEntryOutlook') {
          pendingTailEntryOutlook = event.outlook;
          setTailEntryOutlook(event.outlook);
        }
        if (event.type === 'tailEntryRun') {
          pendingTailEntryRun = event.run;
          setTailEntryRun(event.run);
        }
        if (event.type === 'token') {
          summary += event.text;
          setStreamingSummary(summary);
        }
        if (event.type === 'done') {
          const mergedOutlook =
            event.tailEntryOutlook ?? pendingTailEntryOutlook;
          const mergedRun = event.tailEntryRun ?? pendingTailEntryRun;
          finalResult = {
            query: event.query,
            sectors: event.sectors,
            candidates: event.candidates,
            diamondPicks: event.diamondPicks,
            rotationSummary: event.rotationSummary,
            hotNews: event.hotNews,
            hotThemes: event.hotThemes,
            mode: event.mode,
            passed: event.passed,
            missingSections: event.missingSections,
            missingKeywords: event.missingKeywords,
            sessionId: event.sessionId,
            elapsedMs: event.elapsedMs,
            asOfDate: event.asOfDate,
            fetchErrors: event.fetchErrors,
            tailEntryOutlook: mergedOutlook,
            tailEntryRun: mergedRun,
          };
          setScreenResult(finalResult);
          setTailEntryOutlook(mergedOutlook);
          setTailEntryRun(mergedRun);
          setHotNews(event.hotNews);
          setAutoQuery(event.query);
          setSectors(event.sectors);
          setCandidates(event.candidates);
          setDiamondPicks(event.diamondPicks);
          setStreamingSummary(event.rotationSummary);
          setLoading(false);
          setCurrentStep(null);
        }
        if (event.type === 'error') throw new Error(event.message);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
      setCurrentStep(null);
    }
  }

  async function handleCommittee() {
    const pool = screenResult?.candidates ?? candidates;
    if (pool.length === 0) {
      setError('请先完成板块选股，或确保有候选股');
      return;
    }

    setCommitteeLoading(true);
    setError(null);
    setCommitteeResult(null);
    setTradePlans([]);
    setStreamingMemo('');
    setCommitteeStep(null);

    try {
      const response = await fetch('/api/committee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: pool.slice(0, 3).map((c) => ({
            symbol: c.symbol,
            name: c.name,
          })),
          screeningSessionId: screenResult?.sessionId,
        }),
      });

      if (!response.ok) {
        const data: unknown = await response.json();
        throw new Error((data as { error?: string }).error ?? '请求失败');
      }

      let memo = '';
      let finalResult: CommitteeResult | null = null;

      await readSSEStream(response, (_eventName, data) => {
        const event = JSON.parse(data) as CommitteeStreamEvent;
        if (event.type === 'step') setCommitteeStep(event.label);
        if (event.type === 'tradePlans') setTradePlans(event.tradePlans);
        if (event.type === 'token') {
          memo += event.text;
          setStreamingMemo(memo);
        }
        if (event.type === 'done') {
          finalResult = {
            memo: event.memo,
            passed: event.passed,
            sessionId: event.sessionId,
            elapsedMs: event.elapsedMs,
            tradePlans: event.tradePlans,
          };
          setCommitteeResult(finalResult);
          setTradePlans(event.tradePlans);
          setStreamingMemo(event.memo);
          setCommitteeLoading(false);
          setCommitteeStep(null);
        }
        if (event.type === 'error') throw new Error(event.message);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setCommitteeLoading(false);
      setCommitteeStep(null);
    }
  }

  async function handleBatchResearch() {
    const pool = screenResult?.candidates ?? candidates;
    const symbols = pool.slice(0, 5).map((c) => c.symbol);
    if (symbols.length === 0) {
      setError('暂无候选股可批量生成研报');
      return;
    }

    setBatchLoading(true);
    setError(null);
    setBatchResults([]);

    try {
      const response = await fetch('/api/research/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? '批量生成失败');
      }

      const payload = data as {
        results: Array<{
          symbol: string;
          name: string;
          passed: boolean;
          reportId?: string;
          error?: string;
        }>;
      };
      setBatchResults(payload.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setBatchLoading(false);
    }
  }

  const displaySummary = screenResult?.rotationSummary ?? streamingSummary;
  const summarySections = splitMarkdownSections(displaySummary);
  const summaryDisclaimer = extractMarkdownDisclaimer(displaySummary);
  const displayMemo = committeeResult?.memo ?? streamingMemo;
  const displayTradePlans = committeeResult?.tradePlans ?? tradePlans;
  const displayHotNews = screenResult?.hotNews ?? hotNews;
  const displayQuery = screenResult?.query ?? autoQuery;
  const displayDiamondPicks = screenResult?.diamondPicks ?? diamondPicks;
  const displayTailEntryOutlook =
    screenResult?.tailEntryOutlook ?? tailEntryOutlook;
  const displayTailEntryRun = screenResult?.tailEntryRun ?? tailEntryRun;
  const isTailEntryLoading = loading && currentStep === '明日预判';
  const resolvedTailEntry = resolveTailEntryDisplay({
    run: displayTailEntryRun,
    outlook: displayTailEntryOutlook,
    fetchErrors: screenResult?.fetchErrors,
    rotationSummary: displaySummary,
    asOfDate: screenResult?.asOfDate,
    screenCompleted: Boolean(screenResult && !loading),
  });
  const showTailEntryPanel =
    isTailEntryLoading ||
    Boolean(resolvedTailEntry.run) ||
    Boolean(screenResult && !loading && !screenResult.asOfDate);

  const isScreenActive = loading && !screenResult;
  const isCommitteeActive = committeeLoading && !committeeResult;

  return (
    <main className="page page--screen">
      <PageHeader
        title="智能选股"
        description={`主线趋势选股：从近 ${lookbackDays} 日热点中识别市场主线，筛选契合主线且具备 60/120 日趋势性收益的标的；收盘前还会自动生成明日板块预判与尾盘参考。`}
      />

      <div className="screen-stack">
        <div className="action-panel screen-toolbar">
          <div className="action-panel-row action-panel-row--actions">
            <button
              className="button button-lg"
              type="button"
              disabled={loading || committeeLoading}
              onClick={() => handleScreenSubmit()}
            >
              {loading ? '正在扫描热点…' : '开始智能选股'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={loading || committeeLoading}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? '收起主题' : '指定主题'}
            </button>
            {screenResult?.sessionId && (
              <Link
                href={`/screen/history/${screenResult.sessionId}`}
                className="button button-secondary"
              >
                查看本次记录
              </Link>
            )}
            <Link href="/screen/history" className="button button-secondary">
              选股记录
            </Link>
            <Link href="/monitor" className="button button-secondary">
              消息雷达
            </Link>
          </div>

          {showAdvanced && (
            <form className="advanced-panel" onSubmit={handleScreenSubmit}>
              <div className="action-panel-row action-panel-row--primary">
                <input
                  className="input input-wide"
                  value={queryOverride}
                  onChange={(e) => setQueryOverride(e.target.value)}
                  placeholder="可选约束，如「高股息央企」"
                  disabled={loading || committeeLoading}
                  aria-label="选股主题约束"
                />
                <button
                  className="button"
                  type="submit"
                  disabled={
                    loading || committeeLoading || !queryOverride.trim()
                  }
                >
                  按主题选股
                </button>
              </div>
            </form>
          )}

          {isScreenActive && (
            <WorkflowStatus
              label="正在为你选股"
              steps={SCREEN_STEPS}
              currentStep={currentStep}
            />
          )}

          {isCommitteeActive && (
            <WorkflowStatus
              label="正在深度分析"
              steps={COMMITTEE_STEPS}
              currentStep={committeeStep}
            />
          )}
        </div>

        {error && <div className="error">{error}</div>}

        {(displayQuery || screenResult) && (
          <div className="screen-meta">
            {displayQuery && (
              <div className="result-toolbar">
                <span className="muted">选股依据</span>
                <strong>{displayQuery}</strong>
              </div>
            )}
            {screenResult && (
              <div className="result-toolbar">
                <QualityBadge passed={screenResult.passed} kind="screen" />
                {!screenResult.passed && screenResult.missingSections.length > 0 && (
                  <span className="muted">
                    待补充：{screenResult.missingSections.join('、')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {showTailEntryPanel && (
          <TailEntryOutlookPanel
            run={resolvedTailEntry.run}
            outlook={resolvedTailEntry.outlook}
            loading={isTailEntryLoading}
            rotationSummary={displaySummary}
          />
        )}

        {(displayHotNews.length > 0 || sectors.length > 0) && (
          <div className="insight-grid insight-grid--pair">
            {displayHotNews.length > 0 && (
              <section className="pane-card insight-panel">
                <h2 className="section-title">近 {lookbackDays} 日热点</h2>
                <ul className="sector-list sector-list--compact">
                  {displayHotNews.slice(0, 6).map((item) => (
                    <li key={item.title + item.datetime}>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                      {item.datetime && (
                        <span className="news-item-time">
                          {formatNewsTime(item.datetime)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {sectors.length > 0 && (
              <section className="pane-card insight-panel">
                <h2 className="section-title">热门板块</h2>
                <ul className="sector-list sector-list--compact">
                  {sectors.map((s) => (
                    <li key={s.name}>
                      <strong>{s.name}</strong>
                      <span className="muted"> — {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {summarySections.length > 0 && (
          <div className="insight-blocks-wrap">
            <h2 className="insight-blocks-heading">市场解读</h2>
            <div className="insight-blocks">
              {summarySections.map((section) => (
                <section key={section.id} className="pane-card insight-block">
                  <h3 className="insight-block-title">{section.title}</h3>
                  {section.content ? (
                    <article className="report">
                      <ReportMarkdown source={section.content} />
                    </article>
                  ) : null}
                </section>
              ))}
            </div>
            {summaryDisclaimer && (
              <p className="muted insight-disclaimer">{summaryDisclaimer}</p>
            )}
          </div>
        )}

        {displayDiamondPicks.length > 0 && (
          <section className="section">
            <h2 className="section-title">钻石推荐 · {displayDiamondPicks.length} 只</h2>
            <p className="muted">
              候选池中触发钻石信号，已优先展示并写入信号库。
            </p>
            <div className="candidate-grid">
              {displayDiamondPicks.map((c) => (
                <article
                  key={c.symbol}
                  className={`candidate-card diamond-card diamond-card--${c.diamond?.strength ?? 'blue'}`}
                >
                  <div className="candidate-card-head">
                    <strong>{c.name}</strong>
                    <span
                      className={`diamond-badge diamond-badge--${c.diamond?.strength ?? 'blue'}`}
                    >
                      {c.diamond?.strength === 'red' ? '红钻' : '蓝钻'}
                    </span>
                  </div>
                  <span className="candidate-card-code">{c.symbol}</span>
                  {c.diamond && (
                    <ul className="sector-list sector-list--compact">
                      {c.diamond.reasons.slice(0, 3).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <StockKlineChart symbol={c.symbol} height={200} />
                  <div className="candidate-card-actions">
                    <Link href={`/?symbol=${c.symbol}`} className="button button-secondary">
                      生成研报
                    </Link>
                    <AddToWatchlistButton
                      symbol={c.symbol}
                      name={c.name}
                      reason={c.thesis.slice(0, 120)}
                      sourceType="screening"
                      sourceId={screenResult?.sessionId}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {candidates.length > 0 ? (
          <section className="candidates-section">
            <div className="section-toolbar">
              <h2 className="section-title">候选池 · {candidates.length} 只</h2>
              {screenResult && !committeeResult && !committeeLoading && (
                <div className="section-toolbar-actions">
                  <button type="button" className="button" onClick={handleCommittee}>
                    深度分析
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={batchLoading}
                    onClick={handleBatchResearch}
                  >
                    {batchLoading
                      ? '正在生成…'
                      : `批量研报（${Math.min(candidates.length, 5)}）`}
                  </button>
                </div>
              )}
            </div>
            <p className="muted section-toolbar-hint">
              每张卡片含近 120 日 K 线与红/蓝钻历史标记（滚动进入视口后加载）。
            </p>

            <div className="candidate-grid">
              {candidates.map((c) => {
                const { price, change, summary } = formatCandidateThesis(c.thesis);
                return (
                  <article key={c.symbol} className="candidate-card">
                    <div className="candidate-card-head">
                      <strong>{c.name}</strong>
                      {c.factorScore && (
                        <span
                          className={`factor-outlook factor-outlook--${c.factorScore.outlook}`}
                        >
                          {c.factorScore.outlookLabel} · {c.factorScore.total}分
                        </span>
                      )}
                      {c.diamond?.strength === 'red' && (
                        <span className="diamond-badge diamond-badge--red">红钻</span>
                      )}
                      {c.diamond?.strength === 'blue' && (
                        <span className="diamond-badge diamond-badge--blue">蓝钻</span>
                      )}
                      <span className="candidate-card-code">{c.symbol}</span>
                    </div>
                    {(price || change || c.factorScore) && (
                      <div className="candidate-card-stats">
                        {c.factorScore && (
                          <span className="muted">
                            主线 {c.factorScore.themeScore}
                            {c.factorScore.matchedTheme
                              ? ` · ${c.factorScore.matchedTheme}`
                              : ''}
                            {c.factorScore.ret60dPct != null
                              ? ` · 60日 ${c.factorScore.ret60dPct}%`
                              : ''}
                          </span>
                        )}
                        {change && (
                          <span className={change.startsWith('-') ? 'return-down' : 'return-up'}>
                            {change}
                          </span>
                        )}
                        {price && <span className="muted">¥{price}</span>}
                      </div>
                    )}
                    <p className="candidate-card-thesis">{summary}</p>
                    <StockKlineChart symbol={c.symbol} height={200} />
                    <div className="candidate-card-actions">
                      <Link href={`/?symbol=${c.symbol}`} className="button button-secondary">
                        生成研报
                      </Link>
                      <AddToWatchlistButton
                        symbol={c.symbol}
                        name={c.name}
                        reason={c.thesis.slice(0, 120)}
                        sourceType="screening"
                        sourceId={screenResult?.sessionId}
                      />
                    </div>
                  </article>
                );
              })}
            </div>

            {batchResults.length > 0 && (
              <ul className="sector-list batch-results pane-card">
                {batchResults.map((item) => (
                  <li key={item.symbol}>
                    <strong>
                      {item.name} ({item.symbol})
                    </strong>
                    <QualityBadge passed={item.passed} kind="report" />
                    {item.error && <span className="muted"> — {item.error}</span>}
                    {item.reportId && (
                      <>
                        {' '}
                        <Link href={`/history/${item.reportId}`} className="saved-link">
                          查看研报
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : screenResult && !loading ? (
          <section className="section pane-card">
            <h2 className="section-title">候选池为空</h2>
            <p className="muted">
              新闻和板块分析已完成，但问财没有返回可解析的个股列表。
              可能是问财接口暂时无数据，或当前主题下没有命中条件的 A 股。
            </p>
            {screenResult.fetchErrors && screenResult.fetchErrors.length > 0 && (
              <ul className="sector-list">
                {screenResult.fetchErrors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            <p className="muted">
              建议：稍后重试，或在「指定主题」里换一个更常见的主题词（如「半导体」「高股息」）。
            </p>
          </section>
        ) : (
          !loading && (
            <div className="empty-state">
              点击「开始智能选股」，候选股将以卡片形式展示在下方
            </div>
          )
        )}

        {committeeResult && (
          <div className="result-toolbar">
            <QualityBadge passed={committeeResult.passed} kind="committee" />
          </div>
        )}

        {displayTradePlans.length > 0 && (
          <CommitteeTradePanel tradePlans={displayTradePlans} />
        )}

        {displayMemo && (
          <section className="pane-card memo-panel">
            <h2 className="section-title">深度分析</h2>
            <article className="report">
              <ReportMarkdown source={displayMemo} />
            </article>
          </section>
        )}

        <p className="disclaimer">仅供学习研究，不构成投资建议。数据来自公开行情与新闻接口。</p>
      </div>
    </main>
  );
}

export default function ScreenPage() {
  return (
    <Suspense fallback={<div className="list-loading">加载中…</div>}>
      <ScreenPageContent />
    </Suspense>
  );
}
