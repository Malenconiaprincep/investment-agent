'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EquityChart, type EquityPoint } from '@/components/charts/EquityChart';
import { PageHeader } from '@/components/ui/PageHeader';

type PaperPayload = {
  account: { cash: number; initialCash: number };
  totalValue: number;
  marketValue: number;
  returnPct: number;
  tradeDate: string;
  isTradingSession: boolean;
  positions: Array<{
    symbol: string;
    name: string;
    shares: number;
    avgCost: number;
    availableShares: number;
    frozenShares: number;
    latestPrice: number | null;
    marketValue: number | null;
    pnlPct: number | null;
    stopLoss: number | null;
    highWaterMark: number | null;
    entryMemo: string | null;
  }>;
};

type Trade = {
  id: string;
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

export default function PaperTradingPage() {
  const [data, setData] = useState<PaperPayload | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [accountRes, tradesRes, equityRes] = await Promise.all([
          fetch('/api/paper'),
          fetch('/api/paper/trades?limit=50'),
          fetch('/api/paper/equity?limit=90'),
        ]);
        const accountJson = await accountRes.json();
        const tradesJson = await tradesRes.json();
        const equityJson = await equityRes.json();

        if (!accountRes.ok) throw new Error(accountJson.error ?? '加载失败');
        setData(accountJson as PaperPayload);
        setTrades(tradesJson.trades ?? []);
        setEquity(
          (equityJson.snapshots ?? []).map(
            (s: { tradeDate: string; totalValue: number; returnPct: number }) => ({
              tradeDate: s.tradeDate,
              totalValue: s.totalValue,
              returnPct: s.returnPct,
            }),
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <main className="page page--list">
      <PageHeader
        title="模拟操盘"
        description="100 万虚拟资金，动量派策略：收盘后选股，红钻 + Checklist 买入，止损/破 MA20/移动止盈出场。"
      />

      <div className="paper-rules pane-card">
        <h3 className="pane-card-title">动量派规则</h3>
        <ul className="paper-rules-list">
          <li>
            <strong>T+1：</strong>当日买入冻结，下一交易日方可卖出
          </li>
          <li>
            <strong>买入：</strong>15:05 收盘后 · 智能选股 · 红钻 + Checklist ≥4 项 · 单票约 15%
          </li>
          <li>
            <strong>卖出：</strong>硬止损 -8% · 跌破 MA20 · 移动止盈（自高点回撤 12%）· 信号消失
          </li>
          <li>
            <strong>手动：</strong>交易时段 9:30–11:30、13:00–15:00 内可在自选页下单
          </li>
        </ul>
        {data && (
          <p className="muted paper-session-hint">
            今日 {data.tradeDate} ·{' '}
            {data.isTradingSession ? '当前在交易时段' : '当前非交易时段'}
          </p>
        )}
      </div>

      <nav className="page-toolbar">
        <Link href="/watchlist" className="button button-secondary">
          我的自选
        </Link>
        <Link href="/signals" className="button button-secondary">
          信号提醒
        </Link>
        <Link href="/reviews" className="button button-secondary">
          每周复盘
        </Link>
      </nav>

      {loading && <div className="list-loading">加载账户…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <div className="paper-summary">
            <div>
              <span className="muted">总资产</span>
              <strong>{data.totalValue.toFixed(0)}</strong>
            </div>
            <div>
              <span className="muted">持仓市值</span>
              <strong>{data.marketValue.toFixed(0)}</strong>
            </div>
            <div>
              <span className="muted">可用现金</span>
              <strong>{data.account.cash.toFixed(0)}</strong>
            </div>
            <div>
              <span className="muted">累计收益</span>
              <strong className={data.returnPct >= 0 ? 'return-up' : 'return-down'}>
                {data.returnPct > 0 ? '+' : ''}
                {data.returnPct}%
              </strong>
            </div>
          </div>

          <section className="pane-card paper-equity-section">
            <h3 className="pane-card-title">收益曲线</h3>
            <EquityChart points={equity} />
          </section>

          {data.positions.length === 0 ? (
            <div className="empty-state">
              暂无持仓。自动任务会在红钻信号出现时买入，也可在
              <Link href="/watchlist">自选详情</Link>
              页手动模拟买入。
            </div>
          ) : (
            <section className="pane-card">
              <h3 className="pane-card-title">当前持仓</h3>
              <div className="table-scroll-wrap">
                <table className="candidate-table">
                  <thead>
                    <tr>
                      <th>代码</th>
                      <th>名称</th>
                      <th>持仓</th>
                      <th>可卖</th>
                      <th>冻结</th>
                      <th>成本</th>
                      <th>现价</th>
                      <th>止损</th>
                      <th>盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => (
                      <tr key={p.symbol}>
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
                        <td>{p.availableShares}</td>
                        <td>{p.frozenShares}</td>
                        <td>{p.avgCost.toFixed(2)}</td>
                        <td>{p.latestPrice?.toFixed(2) ?? '—'}</td>
                        <td>{p.stopLoss?.toFixed(2) ?? '—'}</td>
                        <td
                          className={
                            p.pnlPct != null && p.pnlPct >= 0 ? 'return-up' : 'return-down'
                          }
                        >
                          {p.pnlPct != null ? `${p.pnlPct}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

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
                      <th>方向</th>
                      <th>标的</th>
                      <th>股数</th>
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
                        <td>{t.source === 'auto' ? '自动' : '手动'}</td>
                        <td className="paper-trade-note">{t.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <p className="disclaimer">模拟交易仅供学习，不构成投资建议。</p>
    </main>
  );
}
