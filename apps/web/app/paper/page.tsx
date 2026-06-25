'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EquityChart, type EquityPoint } from '@/components/charts/EquityChart';
import { OpenWatchlistPanelButton } from '@/components/OpenWatchlistPanelButton';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  normalizeDualPaperPayload,
  type DualPaperPayload,
} from '@/lib/paper-dual';

type PaperBucket = 'combined' | 'etf' | 'stock';

type Trade = {
  id: string;
  bucket?: 'etf' | 'stock';
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number;
  tradeDate: string;
  tradedAt: string;
  source: 'manual' | 'auto';
  note: string | null;
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function fmtMoney(v: number) {
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function formatTradeSource(trade: Trade) {
  if (trade.note?.includes('ETF 动量')) return 'ETF 动量';
  if (trade.note?.startsWith('monitor-watchlist:')) return '消息雷达';
  if (trade.note?.startsWith('monitor:')) return '消息雷达';
  if (trade.note?.startsWith('monitor-exit:')) return '规则卖出';
  if (trade.note?.includes('动量派')) return '动量选股';
  return trade.source === 'auto' ? '自动' : '手动';
}

function formatTradeNote(note: string | null) {
  if (!note) return '—';
  if (note.startsWith('monitor-watchlist:')) return '自选跟踪动量达标自动买入';
  if (note.startsWith('monitor:')) return '消息雷达自动买入';
  if (note.startsWith('monitor-exit:')) {
    return `消息雷达卖出检查：${note.replace('monitor-exit:', '')}`;
  }
  return note;
}

function mergeEquityCurves(
  etf: EquityPoint[],
  stock: EquityPoint[],
): EquityPoint[] {
  const byDate = new Map<string, { totalValue: number; initialCash: number }>();
  for (const point of etf) {
    const initialCash = point.totalValue / (1 + point.returnPct / 100);
    byDate.set(point.tradeDate, {
      totalValue: point.totalValue,
      initialCash,
    });
  }
  for (const point of stock) {
    const stockInitial = point.totalValue / (1 + point.returnPct / 100);
    const prev = byDate.get(point.tradeDate);
    if (prev) {
      prev.totalValue += point.totalValue;
      prev.initialCash += stockInitial;
    } else {
      byDate.set(point.tradeDate, {
        totalValue: point.totalValue,
        initialCash: stockInitial,
      });
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tradeDate, v]) => ({
      tradeDate,
      totalValue: Number(v.totalValue.toFixed(2)),
      returnPct:
        v.initialCash > 0
          ? Number((((v.totalValue - v.initialCash) / v.initialCash) * 100).toFixed(2))
          : 0,
    }));
}

function bucketLabel(bucket: PaperBucket) {
  if (bucket === 'etf') return 'ETF 仓';
  if (bucket === 'stock') return '股票仓';
  return '总览';
}

export default function PaperTradingPage() {
  const [dual, setDual] = useState<DualPaperPayload | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [activeBucket, setActiveBucket] = useState<PaperBucket>('combined');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const bucketQuery =
        activeBucket === 'combined' ? '' : `&bucket=${activeBucket}`;
      const [accountRes, tradesRes, equityRes] = await Promise.all([
        fetch('/api/paper'),
        fetch(
          activeBucket === 'combined'
            ? '/api/paper/trades?limit=50'
            : `/api/paper/trades?limit=50${bucketQuery}`,
        ),
        activeBucket === 'combined'
          ? Promise.all([
              fetch('/api/paper/equity?limit=90&bucket=etf'),
              fetch('/api/paper/equity?limit=90&bucket=stock'),
            ])
          : fetch(`/api/paper/equity?limit=90${bucketQuery}`),
      ]);

      const accountJson = await accountRes.json();
      if (!accountRes.ok) throw new Error(accountJson.error ?? '加载失败');
      setDual(normalizeDualPaperPayload(accountJson));

      if (activeBucket === 'combined' && Array.isArray(equityRes)) {
        const [etfEquityRes, stockEquityRes] = equityRes;
        const etfJson = await etfEquityRes.json();
        const stockJson = await stockEquityRes.json();
        const etfPoints = (etfJson.snapshots ?? []).map(
          (s: { tradeDate: string; totalValue: number; returnPct: number }) => ({
            tradeDate: s.tradeDate,
            totalValue: s.totalValue,
            returnPct: s.returnPct,
          }),
        );
        const stockPoints = (stockJson.snapshots ?? []).map(
          (s: { tradeDate: string; totalValue: number; returnPct: number }) => ({
            tradeDate: s.tradeDate,
            totalValue: s.totalValue,
            returnPct: s.returnPct,
          }),
        );
        setEquity(mergeEquityCurves(etfPoints, stockPoints));
      } else if (!Array.isArray(equityRes)) {
        const equityJson = await equityRes.json();
        setEquity(
          (equityJson.snapshots ?? []).map(
            (s: { tradeDate: string; totalValue: number; returnPct: number }) => ({
              tradeDate: s.tradeDate,
              totalValue: s.totalValue,
              returnPct: s.returnPct,
            }),
          ),
        );
      }

      const tradesJson = await tradesRes.json();
      setTrades(tradesJson.trades ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [activeBucket]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dual?.combined?.isTradingSession) return;
    const timer = setInterval(() => void load({ silent: true }), 60_000);
    return () => clearInterval(timer);
  }, [dual?.combined?.isTradingSession, load]);

  const view = useMemo(() => {
    if (!dual?.etf || !dual?.stock || !dual?.combined) return null;
    if (activeBucket === 'etf') return dual.etf;
    if (activeBucket === 'stock') return dual.stock;
    return {
      bucket: 'combined' as const,
      account: {
        cash: dual.etf.account.cash + dual.stock.account.cash,
        initialCash: dual.combined.initialCash,
      },
      totalValue: dual.combined.totalValue,
      marketValue: dual.etf.marketValue + dual.stock.marketValue,
      returnPct: dual.combined.returnPct,
      tradeDate: dual.combined.tradeDate,
      isTradingSession: dual.combined.isTradingSession,
      positions: [
        ...(dual.etf.positions ?? []).map((p) => ({ ...p, positionBucket: 'etf' as const })),
        ...(dual.stock.positions ?? []).map((p) => ({ ...p, positionBucket: 'stock' as const })),
      ],
    };
  }, [dual, activeBucket]);

  const returnAmount =
    view != null ? view.totalValue - view.account.initialCash : 0;
  const positionCount = view?.positions?.length ?? 0;

  return (
    <main className="page page--list">
      <PageHeader
        title="模拟操盘"
        description="10 万虚拟资金双分仓：ETF 动量轮动 + 股票动量派。成交按真实盘口（买=卖一、卖=买一）。"
      />

      <div className="paper-bucket-tabs" role="tablist" aria-label="模拟分仓">
        {(['combined', 'etf', 'stock'] as const).map((bucket) => (
          <button
            key={bucket}
            type="button"
            role="tab"
            aria-selected={activeBucket === bucket}
            className={`paper-bucket-tab${activeBucket === bucket ? ' paper-bucket-tab--active' : ''}`}
            onClick={() => setActiveBucket(bucket)}
          >
            {bucketLabel(bucket)}
          </button>
        ))}
      </div>

      {loading && <div className="list-loading">加载账户…</div>}
      {error && <div className="error">{error}</div>}

      {view && (
        <>
          <div className="paper-hero">
            <div className="paper-hero-main">
              <span className="muted">
                {activeBucket === 'combined' ? '合并收益率' : `${bucketLabel(activeBucket)}收益率`}
              </span>
              <strong
                className={`paper-hero-return ${view.returnPct >= 0 ? 'return-up' : 'return-down'}`}
              >
                {view.returnPct > 0 ? '+' : ''}
                {view.returnPct}%
              </strong>
              <span
                className={`paper-hero-return-amt ${returnAmount >= 0 ? 'return-up' : 'return-down'}`}
              >
                {returnAmount >= 0 ? '+' : ''}
                {fmtMoney(returnAmount)} 元
              </span>
            </div>
            <div className="paper-hero-stats">
              <div>
                <span className="muted">总资产</span>
                <strong>{fmtMoney(view.totalValue)}</strong>
              </div>
              <div>
                <span className="muted">持仓</span>
                <strong>{positionCount} 只</strong>
              </div>
              <div>
                <span className="muted">持仓市值</span>
                <strong>{fmtMoney(view.marketValue)}</strong>
              </div>
              <div>
                <span className="muted">可用现金</span>
                <strong>{fmtMoney(view.account.cash)}</strong>
              </div>
              {activeBucket === 'combined' && dual && (
                <>
                  <div>
                    <span className="muted">ETF 仓</span>
                    <strong>{fmtMoney(dual.etf.totalValue)}</strong>
                  </div>
                  <div>
                    <span className="muted">股票仓</span>
                    <strong>{fmtMoney(dual.stock.totalValue)}</strong>
                  </div>
                </>
              )}
            </div>
          </div>

          <section className="pane-card">
            <h3 className="pane-card-title">
              {activeBucket === 'combined' ? '全部持仓' : `${bucketLabel(activeBucket)}持仓`}
            </h3>
            {view.isTradingSession && (
              <p className="muted paper-price-hint">
                交易时段现价来自东财实时行情，约每 60 秒自动刷新；非交易时段显示最近收盘价。
              </p>
            )}
            {!(view.positions?.length) ? (
              <div className="empty-state">
                {activeBucket === 'etf'
                  ? 'ETF 仓暂无持仓。交易时段内每 30 分钟自动监听，条件满足即按动量轮动调仓。'
                  : '暂无持仓。自动任务会在红钻信号出现时买入，也可在'}
                {activeBucket !== 'etf' && (
                  <>
                    <OpenWatchlistPanelButton className="saved-link">
                      跟踪池
                    </OpenWatchlistPanelButton>
                    查看详情。
                  </>
                )}
              </div>
            ) : (
              <div className="table-scroll-wrap">
                <table className="candidate-table">
                  <thead>
                    <tr>
                      {activeBucket === 'combined' && <th>分仓</th>}
                      <th>代码</th>
                      <th>名称</th>
                      <th>数量</th>
                      <th>可卖</th>
                      <th>成本</th>
                      <th>
                        现价
                        {view.isTradingSession ? (
                          <span className="paper-th-sub">实时</span>
                        ) : (
                          <span className="paper-th-sub">收盘</span>
                        )}
                      </th>
                      <th>市值</th>
                      <th>盈亏</th>
                      <th>止损</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(view.positions ?? []).map((p) => (
                        <tr key={`${'positionBucket' in p ? p.positionBucket : 'x'}-${p.symbol}`}>
                          {activeBucket === 'combined' && (
                            <td>
                              {'positionBucket' in p && p.positionBucket === 'etf' ? 'ETF' : '股票'}
                            </td>
                          )}
                          <td>{p.symbol}</td>
                          <td>
                            {p.name}
                            {p.entryMemo && (
                              <span className="paper-position-memo" title={p.entryMemo}>
                                {' '}
                                ⓘ
                              </span>
                            )}
                          </td>
                          <td>{p.shares}</td>
                          <td>
                            {p.availableShares}
                            {'settlementRule' in p && p.settlementRule === 't0' && (
                              <span className="paper-settlement-tag">T+0</span>
                            )}
                            {'settlementRule' in p && p.settlementRule === 't1' && p.frozenShares > 0 && (
                              <span className="paper-settlement-tag paper-settlement-tag--t1">
                                冻 {p.frozenShares}
                              </span>
                            )}
                          </td>
                          <td>{p.avgCost.toFixed(2)}</td>
                          <td>
                            {p.latestPrice?.toFixed(2) ?? '—'}
                            {'markPriceSource' in p && p.markPriceSource === 'intraday' && (
                              <span className="paper-live-tag">实时</span>
                            )}
                          </td>
                          <td>{p.marketValue != null ? fmtMoney(p.marketValue) : '—'}</td>
                          <td
                            className={
                              p.pnlPct != null && p.pnlPct >= 0 ? 'return-up' : 'return-down'
                            }
                          >
                            {p.pnlPct != null ? `${p.pnlPct > 0 ? '+' : ''}${p.pnlPct}%` : '—'}
                          </td>
                          <td>{p.stopLoss?.toFixed(2) ?? '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pane-card paper-equity-section">
            <h3 className="pane-card-title">收益曲线</h3>
            <EquityChart points={equity ?? []} />
          </section>
        </>
      )}

      <div className="paper-rules pane-card">
        <h3 className="pane-card-title">分仓规则</h3>
        <ul className="paper-rules-list">
          <li>
            <strong>总资金：</strong>10 万（ETF 仓 5 万 + 股票仓 5 万）
          </li>
          <li>
            <strong>成交定价：</strong>买入按卖一、卖出按买一；盘口缺失时退回最新价
          </li>
          <li>
            <strong>ETF 仓：</strong>交易时段每 30 分钟监听 · 首笔轻仓 25% · 调仓日可补至策略仓位 · Top4 动量 · 10 日调仓 · -12% 止损
          </li>
          <li>
            <strong>股票仓：</strong>15:05 后 · 红钻 + Checklist ≥4 · 单票约 15% · 硬止损 -8% / MA20 / 移动止盈
          </li>
          <li>
            <strong>交收规则：</strong>ETF 仓 <strong>T+0</strong>（当日买入当日可卖）· 股票仓 <strong>T+1</strong>（当日买入次日可卖）
          </li>
        </ul>
        {view && (
          <p className="muted paper-session-hint">
            今日 {view.tradeDate} · 初始 {fmtMoney(view.account.initialCash)} 元 ·{' '}
            {view.isTradingSession ? '当前在交易时段' : '当前非交易时段'}
          </p>
        )}
      </div>

      <nav className="page-toolbar">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void load()}
        >
          刷新行情
        </button>
        <OpenWatchlistPanelButton className="button button-secondary">
          跟踪池
        </OpenWatchlistPanelButton>
        <Link href="/signals" className="button button-secondary">
          信号提醒
        </Link>
        <Link href="/reviews" className="button button-secondary">
          每周复盘
        </Link>
      </nav>

      {view && (
        <section className="pane-card">
          <h3 className="pane-card-title">交易流水</h3>
          {trades.length === 0 ? (
            <div className="empty-state">暂无成交记录</div>
          ) : (
            <div className="table-scroll-wrap">
              <table className="candidate-table paper-trades-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    {activeBucket === 'combined' && <th>分仓</th>}
                    <th>方向</th>
                    <th>标的</th>
                    <th>数量</th>
                    <th>价格</th>
                    <th>金额</th>
                    <th>来源</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id}>
                      <td className="paper-trade-time">{fmtTime(t.tradedAt)}</td>
                      {activeBucket === 'combined' && (
                        <td>{t.bucket === 'etf' ? 'ETF' : '股票'}</td>
                      )}
                      <td className={t.side === 'buy' ? 'return-up' : 'return-down'}>
                        {t.side === 'buy' ? '买入' : '卖出'}
                      </td>
                      <td>
                        {t.name}
                        <span className="muted"> ({t.symbol})</span>
                      </td>
                      <td>{t.shares}</td>
                      <td>{t.price.toFixed(2)}</td>
                      <td>{t.amount.toFixed(0)}</td>
                      <td>{formatTradeSource(t)}</td>
                      <td className="paper-trade-note">{formatTradeNote(t.note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="disclaimer">模拟交易仅供学习，不构成投资建议。</p>
    </main>
  );
}
