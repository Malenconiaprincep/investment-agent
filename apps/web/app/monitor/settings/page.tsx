'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { OpenWatchlistPanelButton } from '@/components/OpenWatchlistPanelButton';

type AutoTrackMode = 'balanced' | 'aggressive' | 'notify_only';

type AutoTrackSettings = {
  mode: AutoTrackMode;
  modeLabel: string;
  envDefault: AutoTrackMode;
  envDefaultLabel: string;
  watchlistCount: number;
  watchlistLimit: number;
  rules: Array<{ label: string; detail: string }>;
};

const MODE_OPTIONS: Array<{
  id: AutoTrackMode;
  title: string;
  description: string;
}> = [
  {
    id: 'balanced',
    title: '均衡（推荐）',
    description:
      '潜伏、温和启动自动加池；新闻催化需高优先级且涨幅不大；自选波动不重复加池。',
  },
  {
    id: 'aggressive',
    title: '积极',
    description: '更多提醒类型会尝试自动加池，仍过滤过热、ST 和涨停。',
  },
  {
    id: 'notify_only',
    title: '仅提醒',
    description: '雷达照常扫描展示，不自动写入跟踪池，由你手动决定。',
  },
];

export default function MonitorSettingsPage() {
  const [settings, setSettings] = useState<AutoTrackSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/monitor/settings');
      const data = (await res.json()) as AutoTrackSettings & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectMode(mode: AutoTrackMode) {
    if (!settings || settings.mode === mode) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/monitor/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as AutoTrackSettings & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '保存失败');
      setSettings(data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const poolPct = settings
    ? Math.min(100, Math.round((settings.watchlistCount / settings.watchlistLimit) * 100))
    : 0;

  return (
    <main className="page page--list">
      <PageHeader
        title="雷达设置"
        description="配置消息雷达如何自动把标的加入跟踪池；扫描间隔仍由后台服务控制（默认约 5 分钟）。"
      />

      <div className="list-stack">
        <nav className="page-toolbar">
          <Link href="/monitor" className="button button-secondary">
            ← 返回消息雷达
          </Link>
          <OpenWatchlistPanelButton className="button button-secondary">
            打开跟踪池
          </OpenWatchlistPanelButton>
        </nav>

        {loading && <div className="list-loading">加载设置…</div>}
        {error && <div className="error">{error}</div>}

        {settings && !loading && (
          <>
            <section className="pane-card monitor-settings-section">
              <h2 className="section-title">自动加池策略</h2>
              <p className="muted monitor-settings-hint">
                当前：<strong>{settings.modeLabel}</strong>
                {settings.envDefault !== settings.mode && (
                  <span>
                    {' '}
                    · 环境默认 {settings.envDefaultLabel}（已被页面设置覆盖）
                  </span>
                )}
              </p>

              <div className="monitor-mode-grid">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`monitor-mode-card${
                      settings.mode === option.id ? ' monitor-mode-card--active' : ''
                    }`}
                    disabled={saving}
                    onClick={() => void selectMode(option.id)}
                  >
                    <strong>{option.title}</strong>
                    <p>{option.description}</p>
                  </button>
                ))}
              </div>

              {saved && (
                <p className="monitor-settings-saved">已保存，下一轮扫描起生效。</p>
              )}
            </section>

            <section className="pane-card monitor-settings-section">
              <h2 className="section-title">跟踪池占用</h2>
              <div className="monitor-pool-meter">
                <div
                  className="monitor-pool-meter-bar"
                  style={{ width: `${poolPct}%` }}
                />
              </div>
              <p className="muted">
                {settings.watchlistCount} / {settings.watchlistLimit} 只
                {settings.watchlistCount >= settings.watchlistLimit
                  ? ' · 已满，新标的加池会失败，请手动清理或改用手动跟踪'
                  : ''}
              </p>
            </section>

            <section className="pane-card monitor-settings-section">
              <h2 className="section-title">当前规则明细</h2>
              <ul className="monitor-rules-list">
                {settings.rules.map((rule) => (
                  <li key={rule.label}>
                    <strong>{rule.label}</strong>
                    <span className="muted"> — {rule.detail}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="pane-card monitor-settings-section">
              <h2 className="section-title">说明</h2>
              <ul className="monitor-rules-list">
                <li>
                  <strong>自动加池</strong>
                  <span className="muted">
                    {' '}
                    — 仅影响雷达识别后的写入；你在选股/研报里手动加入的不受此限制
                  </span>
                </li>
                <li>
                  <strong>动量买入</strong>
                  <span className="muted">
                    {' '}
                    — 已在池内的标的仍会按红钻+动量规则尝试模拟盘买入
                  </span>
                </li>
                <li>
                  <strong>环境变量</strong>
                  <span className="muted">
                    {' '}
                    — 可在 agent-core `.env` 设 `MONITOR_AUTO_TRACK=balanced` 作为首次默认
                  </span>
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
