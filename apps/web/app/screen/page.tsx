'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { PageHeader } from '@/components/ui/PageHeader';
import { WorkflowPipeline } from '@/components/ui/WorkflowPipeline';
import { readSSEStream } from '@/lib/sse';

type Sector = { name: string; reason: string; dataSource: string };
type Candidate = {
  symbol: string;
  name: string;
  thesis: string;
  dataSource: string;
};
type HotNewsItem = { title: string; datetime: string; url: string | null };

type ScreenResult = {
  query: string;
  sectors: Sector[];
  candidates: Candidate[];
  rotationSummary: string;
  hotNews: HotNewsItem[];
  hotThemes: string[];
  mode: 'auto' | 'manual';
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  sessionId?: string;
  elapsedMs: number;
};

type CommitteeResult = {
  memo: string;
  passed: boolean;
  sessionId?: string;
  elapsedMs: number;
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
  | { type: 'candidates'; candidates: Candidate[] }
  | {
      type: 'done';
      query: string;
      sectors: Sector[];
      candidates: Candidate[];
      rotationSummary: string;
      hotNews: HotNewsItem[];
      hotThemes: string[];
      mode: 'auto' | 'manual';
      passed: boolean;
      missingSections: string[];
      missingKeywords: string[];
      sessionId: string;
      elapsedMs: number;
    }
  | { type: 'error'; message: string };

type CommitteeStreamEvent =
  | { type: 'step'; label: string }
  | { type: 'token'; text: string }
  | { type: 'specialist'; role: string; status: string }
  | {
      type: 'done';
      memo: string;
      passed: boolean;
      sessionId: string;
      elapsedMs: number;
    }
  | { type: 'error'; message: string };

const SCREEN_STEPS = [
  '扫描热点',
  '板块筛选',
  '候选股筛选',
  '补全基本信息',
  '轮动摘要',
  '质量检查',
];

const COMMITTEE_STEPS = [
  '解析候选池',
  '六组并行分析',
  '投委会综合',
  '质量检查',
];

export default function ScreenPage() {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [queryOverride, setQueryOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [committeeLoading, setCommitteeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [committeeStep, setCommitteeStep] = useState<string | null>(null);
  const [specialists, setSpecialists] = useState<Record<string, string>>({});
  const [streamingSummary, setStreamingSummary] = useState('');
  const [streamingMemo, setStreamingMemo] = useState('');
  const [hotNews, setHotNews] = useState<HotNewsItem[]>([]);
  const [autoQuery, setAutoQuery] = useState<string | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [screenResult, setScreenResult] = useState<ScreenResult | null>(null);
  const [committeeResult, setCommitteeResult] = useState<CommitteeResult | null>(
    null,
  );

  async function handleScreenSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setCommitteeLoading(false);
    setError(null);
    setScreenResult(null);
    setCommitteeResult(null);
    setSectors([]);
    setCandidates([]);
    setHotNews([]);
    setAutoQuery(null);
    setStreamingSummary('');
    setStreamingMemo('');
    setSpecialists({});
    setCurrentStep(null);

    const trimmedOverride = queryOverride.trim();
    const body =
      showAdvanced && trimmedOverride
        ? { query: trimmedOverride, maxCandidates: 10 }
        : { maxCandidates: 10 };

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

      await readSSEStream(response, (_eventName, data) => {
        const event = JSON.parse(data) as ScreenStreamEvent;
        if (event.type === 'step') setCurrentStep(event.label);
        if (event.type === 'hotNews') {
          setHotNews(event.hotNews);
          setAutoQuery(event.query);
        }
        if (event.type === 'sectors') setSectors(event.sectors);
        if (event.type === 'candidates') setCandidates(event.candidates);
        if (event.type === 'token') {
          summary += event.text;
          setStreamingSummary(summary);
        }
        if (event.type === 'done') {
          finalResult = {
            query: event.query,
            sectors: event.sectors,
            candidates: event.candidates,
            rotationSummary: event.rotationSummary,
            hotNews: event.hotNews,
            hotThemes: event.hotThemes,
            mode: event.mode,
            passed: event.passed,
            missingSections: event.missingSections,
            missingKeywords: event.missingKeywords,
            sessionId: event.sessionId,
            elapsedMs: event.elapsedMs,
          };
          setScreenResult(finalResult);
          setHotNews(event.hotNews);
          setAutoQuery(event.query);
          setSectors(event.sectors);
          setCandidates(event.candidates);
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
    setStreamingMemo('');
    setSpecialists({});
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
        if (event.type === 'specialist') {
          setSpecialists((prev) => ({
            ...prev,
            [event.role]: event.status,
          }));
        }
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
          };
          setCommitteeResult(finalResult);
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

  const displaySummary = screenResult?.rotationSummary ?? streamingSummary;
  const displayMemo = committeeResult?.memo ?? streamingMemo;
  const displayHotNews = screenResult?.hotNews ?? hotNews;
  const displayQuery = screenResult?.query ?? autoQuery;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Workflow"
        title="自动选股"
        description="扫描问财热点新闻与强势板块，自动筛选候选股。需配置 IWENCAI_API_KEY。"
      />

      <div className="layout-split">
        <aside className="layout-split-aside">
          {(loading || screenResult) && (
            <WorkflowPipeline steps={SCREEN_STEPS} currentStep={currentStep} />
          )}
          {committeeLoading && (
            <div style={{ marginTop: '1.5rem' }}>
              <p className="section-title">投委会</p>
              <WorkflowPipeline
                steps={COMMITTEE_STEPS}
                currentStep={committeeStep}
              />
              {Object.keys(specialists).length > 0 && (
                <div className="specialist-grid">
                  {Object.entries(specialists).map(([role, status]) => (
                    <span key={role} className="chip">
                      {role}: {status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>

        <div>
          <div className="form">
            <button
              className="button button-lg"
              type="button"
              disabled={loading || committeeLoading}
              onClick={() => handleScreenSubmit()}
            >
              {loading ? '扫描热点并选股…' : '开始自动选股'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={loading || committeeLoading}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? '收起高级' : '指定主题'}
            </button>
          </div>

          {showAdvanced && (
            <form className="form advanced-panel" onSubmit={handleScreenSubmit}>
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
            </form>
          )}

          {loading && !screenResult && (
            <div className="loading-block">
              <p>板块选股 Workflow 执行中…</p>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {displayQuery && (
            <div className="status-bar">
              <span>
                选股依据：<strong>{displayQuery}</strong>
              </span>
            </div>
          )}

          {displayHotNews.length > 0 && (
            <section className="section">
              <h2 className="section-title">今日热点</h2>
              <ul className="sector-list">
                {displayHotNews.slice(0, 8).map((item) => (
                  <li key={item.title}>
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
                  </li>
                ))}
              </ul>
            </section>
          )}

          {screenResult && (
            <div className="status-bar">
              <span className={`badge ${screenResult.passed ? 'pass' : 'fail'}`}>
                选股 {screenResult.passed ? 'PASS' : 'FAIL'}
              </span>
              {!screenResult.passed && (
                <span className="muted">
                  {screenResult.missingSections.length > 0 &&
                    `缺少：${screenResult.missingSections.join('、')}`}
                </span>
              )}
              <span className="muted">
                {(screenResult.elapsedMs / 1000).toFixed(1)}s
              </span>
              {screenResult.sessionId && (
                <Link
                  href={`/screen/history/${screenResult.sessionId}`}
                  className="saved-link"
                >
                  已保存 · 查看
                </Link>
              )}
              <button
                type="button"
                className="button button-secondary"
                disabled={committeeLoading}
                onClick={handleCommittee}
              >
                {committeeLoading ? '投委会分析中…' : '进入投委会'}
              </button>
            </div>
          )}

          {sectors.length > 0 && (
            <section className="section">
              <h2 className="section-title">热门板块</h2>
              <ul className="sector-list">
                {sectors.map((s) => (
                  <li key={s.name}>
                    <strong>{s.name}</strong>
                    <span className="muted"> — {s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {candidates.length > 0 && (
            <section className="section">
              <h2 className="section-title">候选池</h2>
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>入选理由</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.symbol}>
                      <td>{c.symbol}</td>
                      <td>{c.name}</td>
                      <td>{c.thesis.slice(0, 80)}</td>
                      <td>
                        <Link
                          href={`/?symbol=${c.symbol}`}
                          className="saved-link"
                        >
                          生成研报
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {displaySummary && (
            <section className="section">
              <h2 className="section-title">板块轮动摘要</h2>
              <article className="report">
                <ReportMarkdown source={displaySummary} />
              </article>
            </section>
          )}

          {committeeResult && (
            <div className="status-bar">
              <span
                className={`badge ${committeeResult.passed ? 'pass' : 'fail'}`}
              >
                投委会 {committeeResult.passed ? 'PASS' : 'FAIL'}
              </span>
              <span className="muted">
                {(committeeResult.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
          )}

          {displayMemo && (
            <section className="section">
              <h2 className="section-title">投委会纪要</h2>
              <article className="report">
                <ReportMarkdown source={displayMemo} />
              </article>
            </section>
          )}

          <p className="disclaimer">
            仅供学习研究，不构成投资建议。数据来自问财 OpenAPI 与东财。
          </p>
        </div>
      </div>
    </main>
  );
}
