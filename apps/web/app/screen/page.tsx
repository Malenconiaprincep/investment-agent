'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { PageHeader } from '@/components/ui/PageHeader';
import { QualityBadge } from '@/components/ui/QualityBadge';
import { WorkflowStatus } from '@/components/ui/WorkflowStatus';
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
  '筛选板块',
  '筛选候选股',
  '补充信息',
  '生成摘要',
  '核对结果',
];

const COMMITTEE_STEPS = [
  '整理候选池',
  '多维度分析',
  '综合结论',
  '核对报告',
];

export default function ScreenPage() {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [queryOverride, setQueryOverride] = useState('');
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
  const [screenResult, setScreenResult] = useState<ScreenResult | null>(null);
  const [committeeResult, setCommitteeResult] = useState<CommitteeResult | null>(
    null,
  );
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
  const displayMemo = committeeResult?.memo ?? streamingMemo;
  const displayHotNews = screenResult?.hotNews ?? hotNews;
  const displayQuery = screenResult?.query ?? autoQuery;

  const isScreenActive = loading && !screenResult;
  const isCommitteeActive = committeeLoading && !committeeResult;

  return (
    <main className="page">
      <PageHeader
        title="智能选股"
        description="根据今日热点新闻与强势板块，自动为你筛选值得关注的候选股。"
      />

      <div className="action-panel">
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
            {showAdvanced ? '收起高级' : '指定主题'}
          </button>
          {screenResult?.sessionId && (
            <Link
              href={`/screen/history/${screenResult.sessionId}`}
              className="button button-secondary"
            >
              查看本次记录
            </Link>
          )}
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
                    <Link href={`/?symbol=${c.symbol}`} className="saved-link">
                      生成研报
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {screenResult && !committeeResult && !committeeLoading && (
            <div className="result-actions">
              <button
                type="button"
                className="button"
                onClick={handleCommittee}
              >
                深度分析
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={batchLoading}
                onClick={handleBatchResearch}
              >
                {batchLoading
                  ? '正在生成研报…'
                  : `一键生成研报（前 ${Math.min(candidates.length, 5)} 只）`}
              </button>
              <span className="muted">
                深度分析将聚焦前 {Math.min(candidates.length, 3)} 只候选股
              </span>
            </div>
          )}

          {batchResults.length > 0 && (
            <ul className="sector-list batch-results">
              {batchResults.map((item) => (
                <li key={item.symbol}>
                  <strong>
                    {item.name} ({item.symbol})
                  </strong>
                  <QualityBadge passed={item.passed} kind="report" />
                  {item.error && (
                    <span className="muted"> — {item.error}</span>
                  )}
                  {item.reportId && (
                    <>
                      {' '}
                      <Link
                        href={`/history/${item.reportId}`}
                        className="saved-link"
                      >
                        查看研报
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {displaySummary && (
        <section className="section">
          <h2 className="section-title">市场解读</h2>
          <article className="report">
            <ReportMarkdown source={displaySummary} />
          </article>
        </section>
      )}

      {committeeResult && (
        <div className="result-toolbar">
          <QualityBadge passed={committeeResult.passed} kind="committee" />
        </div>
      )}

      {displayMemo && (
        <section className="section">
          <h2 className="section-title">深度分析</h2>
          <article className="report">
            <ReportMarkdown source={displayMemo} />
          </article>
        </section>
      )}

      <p className="disclaimer">
        仅供学习研究，不构成投资建议。数据来自公开行情与新闻接口。
      </p>
    </main>
  );
}
