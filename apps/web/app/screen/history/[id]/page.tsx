'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CommitteeTradePanel, type CommitteeTradePlanView } from '@/components/CommitteeTradePanel';
import { TailEntryOutlookPanel } from '@/components/TailEntryOutlookPanel';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { FeedbackButtons } from '@/components/ui/FeedbackButtons';
import { AddToWatchlistButton } from '@/components/ui/AddToWatchlistButton';
import { QualityBadge } from '@/components/ui/QualityBadge';

type FeedbackSummary = {
  up: number;
  down: number;
  latest: { rating: 1 | -1 } | null;
};

type ScreeningDetail = {
  id: string;
  query: string;
  sectors: Array<{ name: string; reason: string; dataSource: string }>;
  candidates: Array<{
    symbol: string;
    name: string;
    thesis: string;
    dataSource: string;
  }>;
  rotationSummary: string;
  hotNews: Array<{ title: string; datetime: string; url: string | null }>;
  hotThemes: string[];
  mode: 'auto' | 'manual';
  passed: boolean;
  elapsedMs: number | null;
  createdAt: string;
  tailEntryOutlook?: {
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
  } | null;
  tailEntryRun?: {
    status: 'success' | 'failed' | 'skipped' | 'empty';
    message: string;
    sectorCount: number;
    stockCount: number;
    nextTradeDate?: string;
    ranAt: string;
  } | null;
  feedback?: FeedbackSummary;
  committee: {
    id: string;
    memo: string;
    tradePlans?: CommitteeTradePlanView[];
    passed: boolean;
    elapsedMs: number | null;
    createdAt: string;
  } | null;
};

type BacktestResult = {
  holdDays: number;
  mode: 'to-today' | 'fixed';
  avgReturnPct: number | null;
  candidates: Array<{
    symbol: string;
    name: string;
    baselineDate: string | null;
    baselineClose: number | null;
    latestDate: string | null;
    latestClose: number | null;
    returnPct: number | null;
    error?: string;
  }>;
};

const HOLD_OPTIONS = [
  { label: '入选至今', value: 'auto' },
  { label: '5 日', value: '5' },
  { label: '10 日', value: '10' },
  { label: '20 日', value: '20' },
] as const;

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTradeDate(tradeDate: string | null) {
  if (!tradeDate || tradeDate.length < 8) return '—';
  return `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`;
}

function formatPct(value: number | null) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export default function ScreeningHistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<ScreeningDetail | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [holdPeriod, setHoldPeriod] = useState<string>('auto');
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      if (!params.id) return;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/screenings/${params.id}`);
        const data: unknown = await response.json();

        if (!response.ok) {
          const err = data as { error?: string };
          throw new Error(err.error ?? '加载失败');
        }

        setSession(data as ScreeningDetail);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }

    void loadSession();
  }, [params.id]);

  const loadBacktest = useCallback(
    async (days: string) => {
      if (!params.id) return;

      setBacktestLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/screenings/${params.id}/backtest?days=${encodeURIComponent(days)}`,
        );
        const data: unknown = await response.json();

        if (!response.ok) {
          throw new Error((data as { error?: string }).error ?? '计算失败');
        }

        setBacktest(data as BacktestResult);
        setHoldPeriod(days);
      } catch (err) {
        setError(err instanceof Error ? err.message : '事后验证失败');
      } finally {
        setBacktestLoading(false);
      }
    },
    [params.id],
  );

  useEffect(() => {
    if (session && session.candidates.length > 0) {
      void loadBacktest('auto');
    }
  }, [session, loadBacktest]);

  const backtestCaption =
    backtest?.mode === 'fixed' && backtest.holdDays > 0
      ? `自选股基准价起持有 ${backtest.holdDays} 个交易日，组合平均涨跌`
      : '自选股基准价至最新收盘，组合平均涨跌';

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link href="/screen/history">← 选股记录</Link>
      </p>

      {loading && <div className="loading-block">加载中…</div>}
      {error && <div className="error">{error}</div>}

      {session && (
        <>
          <header className="page-header">
            <p className="page-eyebrow">
              {session.mode === 'auto' ? '智能选股' : '主题选股'}
            </p>
            <h1 className="page-title">{session.query}</h1>
            <p className="page-description">{formatTime(session.createdAt)}</p>
          </header>

          <div className="status-bar">
            <QualityBadge passed={session.passed} kind="screen" />
          </div>

          <FeedbackButtons
            targetType="screening"
            targetId={session.id}
            initial={session.feedback}
          />

          {session.candidates.length > 0 && (
            <div className="candidate-chips">
              {session.candidates.slice(0, 8).map((c) => (
                <AddToWatchlistButton
                  key={c.symbol}
                  symbol={c.symbol}
                  name={c.name}
                  reason={c.thesis.slice(0, 60)}
                  sourceType="screening"
                  sourceId={session.id}
                />
              ))}
            </div>
          )}

          {session.hotNews.length > 0 && (
            <section className="section">
              <h2 className="section-title">当时热点新闻</h2>
              <ul className="sector-list">
                {session.hotNews.map((item) => (
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
                      <span className="muted">
                        {' '}
                        · {formatTime(item.datetime)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {session.sectors.length > 0 && (
            <section className="section">
              <h2 className="section-title">热门板块</h2>
              <ul className="sector-list">
                {session.sectors.map((s) => (
                  <li key={s.name}>
                    <strong>{s.name}</strong>
                    <span className="muted"> — {s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {session.candidates.length > 0 && (
            <section className="section">
              <h2 className="section-title">候选池</h2>
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>入选理由</th>
                  </tr>
                </thead>
                <tbody>
                  {session.candidates.map((c) => (
                    <tr key={c.symbol}>
                      <td>{c.symbol}</td>
                      <td>{c.name}</td>
                      <td>{c.thesis.slice(0, 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="section">
            <div className="section-toolbar">
              <h2 className="section-title">入选后表现</h2>
              <div className="section-toolbar-actions">
                {HOLD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`button button-secondary ${holdPeriod === option.value ? 'button--active' : ''}`}
                    disabled={backtestLoading || session.candidates.length === 0}
                    onClick={() => void loadBacktest(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {backtestLoading && !backtest && (
              <p className="muted">正在计算涨跌幅…</p>
            )}

            {backtest && (
              <>
                <p className="muted">
                  {backtestCaption}{' '}
                  <strong>{formatPct(backtest.avgReturnPct)}</strong>
                </p>
                <table className="candidate-table">
                  <thead>
                    <tr>
                      <th>代码</th>
                      <th>名称</th>
                      <th>基准日</th>
                      <th>基准价</th>
                      <th>对比日</th>
                      <th>对比价</th>
                      <th>涨跌幅</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtest.candidates.map((item) => (
                      <tr key={item.symbol}>
                        <td>{item.symbol}</td>
                        <td>{item.name}</td>
                        <td>{formatTradeDate(item.baselineDate)}</td>
                        <td>{item.baselineClose?.toFixed(2) ?? '—'}</td>
                        <td>{formatTradeDate(item.latestDate)}</td>
                        <td>{item.latestClose?.toFixed(2) ?? '—'}</td>
                        <td
                          className={
                            item.returnPct != null && item.returnPct >= 0
                              ? 'return-up'
                              : item.returnPct != null
                                ? 'return-down'
                                : undefined
                          }
                        >
                          {item.error ?? formatPct(item.returnPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {session.tailEntryRun && (
            <TailEntryOutlookPanel
              run={session.tailEntryRun}
              outlook={session.tailEntryOutlook ?? null}
            />
          )}

          {session.rotationSummary && (
            <section className="section">
              <h2 className="section-title">市场解读</h2>
              <article className="report">
                <ReportMarkdown source={session.rotationSummary} />
              </article>
            </section>
          )}

          {session.committee && (
            <section className="section">
              {session.committee.tradePlans &&
                session.committee.tradePlans.length > 0 && (
                  <CommitteeTradePanel tradePlans={session.committee.tradePlans} />
                )}
              <h2 className="section-title">深度分析</h2>
              <div className="status-bar">
                <QualityBadge
                  passed={session.committee.passed}
                  kind="committee"
                />
              </div>
              <article className="report">
                <ReportMarkdown source={session.committee.memo} />
              </article>
            </section>
          )}
        </>
      )}
    </main>
  );
}
