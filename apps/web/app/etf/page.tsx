'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type EtfRuleCheck = {
  id: string;
  label: string;
  passed: boolean;
  message: string;
};

type EtfOperationPlan = {
  action: 'buy_zone' | 'wait_pullback' | 'watch_only' | 'avoid';
  actionLabel: string;
  buyPrice: number;
  buyZoneLow: number;
  buyZoneHigh: number;
  stopPrice: number;
  takeProfitPrice: number;
  riskPct: number;
  rewardPct: number;
  positionHint: string;
  note: string;
};

type EtfCandidate = {
  symbol: string;
  exchangeCode: string;
  name: string;
  price: number;
  changePct: number;
  volumeRatio: number;
  dailyTurnover: number;
  rsi: number;
  ma5: number;
  ma20: number;
  ma30: number;
  stopPrice: number;
  distToStop: number;
  ruleChecks: EtfRuleCheck[];
  failCount: number;
  status: 'passed' | 'near_pass' | 'failed';
  operationPlan?: EtfOperationPlan;
};

type EtfRun = {
  id: string;
  tradeDate: string;
  status: 'success' | '0_PASS' | 'skipped' | 'failed';
  summary: string;
  generatedAt: string;
  elapsedMs: number | null;
  passedCount: number;
  nearPassCount: number;
  candidates: EtfCandidate[];
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtPct(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtTurnover(value: number) {
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(0)} 万`;
  return value.toFixed(0);
}

function fmtPrice(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(value >= 10 ? 2 : 3);
}

function statusLabel(status: EtfCandidate['status']) {
  if (status === 'passed') return '严格通过';
  if (status === 'near_pass') return '近通过';
  return '淘汰';
}

function runStatusLabel(status: EtfRun['status']) {
  if (status === 'success') return '有推荐';
  if (status === '0_PASS') return '0_PASS';
  if (status === 'skipped') return '已跳过';
  return '失败';
}

export default function EtfPage() {
  const [latest, setLatest] = useState<EtfRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/etf');
      const payload = (await response.json()) as { latest?: EtfRun; error?: string };
      if (!response.ok) throw new Error(payload.error ?? '加载失败');
      setLatest(payload.latest ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/etf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const payload = (await response.json()) as EtfRun & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '执行失败');
      setLatest(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setRunning(false);
    }
  }

  const strictPicks = useMemo(
    () => latest?.candidates.filter((item) => item.status === 'passed') ?? [],
    [latest],
  );
  const nearPass = useMemo(
    () => latest?.candidates.filter((item) => item.status === 'near_pass') ?? [],
    [latest],
  );

  return (
    <main className="page page--list">
      <PageHeader
        eyebrow="ETF 监控"
        title="ETF 尾盘推荐"
        description="工作日 14:00 自动跑 19 只 ETF 池，严格执行 8 条筛选；0 只通过时也保留风险提示和近通过名单。"
      />

      <nav className="page-toolbar" aria-label="ETF 操作">
        <button type="button" className="button" onClick={runNow} disabled={running}>
          {running ? '执行中…' : '手动跑一次'}
        </button>
        <button type="button" className="button button-secondary" onClick={load}>
          刷新
        </button>
      </nav>

      {loading && <div className="list-loading">加载 ETF 推荐…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && !latest && (
        <div className="empty-state">暂无 ETF 推荐记录。可以手动跑一次生成首条结果。</div>
      )}

      {latest && (
        <>
          <section className="paper-hero">
            <div className="paper-hero-main">
              <span className="muted">{latest.tradeDate}</span>
              <strong>{runStatusLabel(latest.status)}</strong>
              <span className="muted">{latest.summary}</span>
            </div>
            <div className="paper-hero-stats">
              <div>
                <span className="muted">严格通过</span>
                <strong>{latest.passedCount}</strong>
              </div>
              <div>
                <span className="muted">近通过</span>
                <strong>{latest.nearPassCount}</strong>
              </div>
              <div>
                <span className="muted">池子规模</span>
                <strong>{latest.candidates.length}</strong>
              </div>
              <div>
                <span className="muted">生成时间</span>
                <strong>{fmtTime(latest.generatedAt)}</strong>
              </div>
            </div>
          </section>

          {latest.status === '0_PASS' && (
            <div className="empty-state">
              今日 0 只通过严格筛选，等待确定性机会；近通过仅用于观察，不当作推荐。
            </div>
          )}

          {strictPicks.length > 0 && (
            <section className="candidates-section">
              <h2>严格通过</h2>
              <div className="candidate-grid">
                {strictPicks.map((item) => (
                  <EtfCard key={item.symbol} item={item} />
                ))}
              </div>
            </section>
          )}

          {nearPass.length > 0 && (
            <section className="candidates-section">
              <h2>近通过观察</h2>
              <div className="candidate-grid">
                {nearPass.map((item) => (
                  <EtfCard key={item.symbol} item={item} />
                ))}
              </div>
            </section>
          )}

          <section className="candidates-section">
            <h2>全池明细</h2>
            <div className="table-scroll-wrap">
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th>ETF</th>
                    <th>状态</th>
                    <th>价格</th>
                    <th>涨跌</th>
                    <th>量比</th>
                    <th>RSI</th>
                    <th>操作位</th>
                    <th>距止损</th>
                    <th>止盈</th>
                    <th>成交额</th>
                    <th>失败项</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.candidates.map((item) => (
                    <tr key={item.symbol}>
                      <td>
                        <strong>{item.name}</strong>
                        <br />
                        <span className="muted">{item.exchangeCode}</span>
                      </td>
                      <td>{statusLabel(item.status)}</td>
                      <td>{item.price.toFixed(3)}</td>
                      <td className={item.changePct >= 0 ? 'return-up' : 'return-down'}>
                        {fmtPct(item.changePct)}
                      </td>
                      <td>{item.volumeRatio.toFixed(2)}</td>
                      <td>{item.rsi.toFixed(1)}</td>
                      <td>
                        {item.operationPlan
                          ? `${fmtPrice(item.operationPlan.buyZoneLow)}-${fmtPrice(item.operationPlan.buyZoneHigh)}`
                          : '—'}
                        <br />
                        <span className="muted">
                          {item.operationPlan?.actionLabel ?? '待生成'}
                        </span>
                      </td>
                      <td>{fmtPct(item.distToStop)}</td>
                      <td>{fmtPrice(item.operationPlan?.takeProfitPrice)}</td>
                      <td>{fmtTurnover(item.dailyTurnover)}</td>
                      <td>
                        {item.ruleChecks
                          .filter((rule) => !rule.passed)
                          .map((rule) => rule.message)
                          .join('；') || '无'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function EtfCard({ item }: { item: EtfCandidate }) {
  const failedRules = item.ruleChecks.filter((rule) => !rule.passed);
  const plan = item.operationPlan;

  return (
    <article className="candidate-card candidate-card--etf">
      <div className="candidate-card-head">
        <strong>{item.name}</strong>
        <span className="candidate-card-code">{item.exchangeCode}</span>
      </div>
      <div className="candidate-card-stats">
        <span>{statusLabel(item.status)}</span>
        <span>价格 {item.price.toFixed(3)}</span>
        <span className={item.changePct >= 0 ? 'return-up' : 'return-down'}>
          {fmtPct(item.changePct)}
        </span>
        <span>量比 {item.volumeRatio.toFixed(2)}</span>
      </div>
      <p className="candidate-card-thesis">
        RSI {item.rsi.toFixed(1)}，MA5/20 {item.ma5.toFixed(3)}/
        {item.ma20.toFixed(3)}，距技术止损 {fmtPct(item.distToStop)}。
      </p>
      {plan && (
        <p className="candidate-card-thesis">
          操作位：{plan.actionLabel}，买入区 {fmtPrice(plan.buyZoneLow)}-
          {fmtPrice(plan.buyZoneHigh)}，止损 {fmtPrice(plan.stopPrice)}，止盈{' '}
          {fmtPrice(plan.takeProfitPrice)}。{plan.positionHint}
        </p>
      )}
      {failedRules.length > 0 && (
        <p className="candidate-card-thesis">
          未通过：{failedRules.map((rule) => rule.message).join('；')}
        </p>
      )}
    </article>
  );
}
