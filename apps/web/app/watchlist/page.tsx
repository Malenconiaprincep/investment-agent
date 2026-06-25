'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DualPaperPayload } from '@/lib/paper-dual';

type WatchlistItem = {
  id: string;
  symbol: string;
  name: string;
  reason: string | null;
  sourceType: 'report' | 'screening' | 'manual' | 'signal' | null;
  sourceId: string | null;
  entryPrice: number | null;
  entryDate: string | null;
  createdAt: string;
  latest?: {
    close: number;
    pctChg: number | null;
    vsEntryPct: number | null;
    diamondStrength: 'red' | 'blue' | null;
    tradeDate?: string;
  } | null;
};

type WatchLevelKey = 'hot' | 'warm' | 'rise' | 'risk' | 'track' | 'manual';
type FilterKey = 'all' | WatchLevelKey | 'held';

type WatchLevel = {
  key: WatchLevelKey;
  label: string;
  className: string;
  status: string;
};

function fmtPct(v: number | null | undefined) {
  if (v == null) return '-';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtPrice(v: number | null | undefined) {
  if (v == null) return '-';
  return v.toFixed(2);
}

function pctClassName(v: number | null | undefined) {
  if (v == null) return 'watchlist-workbench-pct watchlist-workbench-pct--empty';
  if (v > 0) return 'watchlist-workbench-pct watchlist-workbench-pct--up';
  if (v < 0) return 'watchlist-workbench-pct watchlist-workbench-pct--down';
  return 'watchlist-workbench-pct';
}

function sourceLabel(sourceType: WatchlistItem['sourceType']) {
  if (sourceType === 'signal') return '消息雷达';
  if (sourceType === 'screening') return '选股扫描';
  if (sourceType === 'report') return '研报';
  return '手动';
}

function watchLevel(item: WatchlistItem): WatchLevel {
  const diamond = item.latest?.diamondStrength;
  const today = item.latest?.pctChg;
  const sinceEntry = item.latest?.vsEntryPct;

  if (diamond === 'red') {
    return {
      key: 'hot',
      label: 'S 红钻',
      className: 'watchlist-level--hot',
      status: '待动量/AI 复核',
    };
  }
  if (diamond === 'blue') {
    return {
      key: 'warm',
      label: 'A 蓝钻',
      className: 'watchlist-level--warm',
      status: '温和关注',
    };
  }
  if ((today ?? 0) >= 5 || (sinceEntry ?? 0) >= 8) {
    return {
      key: 'rise',
      label: 'B 升温',
      className: 'watchlist-level--rise',
      status: '等待信号确认',
    };
  }
  if ((sinceEntry ?? 0) <= -5) {
    return {
      key: 'risk',
      label: 'R 回撤',
      className: 'watchlist-level--risk',
      status: '优先复核',
    };
  }
  if (item.sourceType === 'manual') {
    return {
      key: 'manual',
      label: 'D 手动',
      className: 'watchlist-level--manual',
      status: '人工观察',
    };
  }
  return {
    key: 'track',
    label: item.sourceType === 'signal' ? 'C 雷达' : 'C 研究',
    className: 'watchlist-level--track',
    status: '等待红钻',
  };
}

function ageDays(item: WatchlistItem) {
  const raw = item.entryDate ?? item.createdAt;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return null;
  const diff = Date.now() - start.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'hot', label: 'S 红钻' },
  { key: 'warm', label: 'A 蓝钻' },
  { key: 'rise', label: 'B 升温' },
  { key: 'risk', label: 'R 回撤' },
  { key: 'track', label: 'C 跟踪' },
  { key: 'manual', label: 'D 手动' },
  { key: 'held', label: '已进模拟盘' },
];

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [heldSymbols, setHeldSymbols] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [watchlistRes, paperRes] = await Promise.all([
        fetch('/api/watchlist'),
        fetch('/api/paper').catch(() => null),
      ]);
      const watchlistJson = (await watchlistRes.json()) as {
        items?: WatchlistItem[];
        error?: string;
      };
      if (!watchlistRes.ok) {
        throw new Error(watchlistJson.error ?? '跟踪池加载失败');
      }

      setItems(watchlistJson.items ?? []);

      if (paperRes?.ok) {
        const paper = (await paperRes.json()) as DualPaperPayload;
        setHeldSymbols(new Set((paper.stock.positions ?? []).map((p) => p.symbol)));
      } else {
        setHeldSymbols(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      items.map((item) => ({
        item,
        level: watchLevel(item),
        held: heldSymbols.has(item.symbol),
        age: ageDays(item),
      })),
    [heldSymbols, items],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim();
    return rows.filter(({ item, level, held }) => {
      if (filter === 'held' && !held) return false;
      if (filter !== 'all' && filter !== 'held' && level.key !== filter) return false;
      if (!q) return true;
      return item.symbol.includes(q) || item.name.includes(q);
    });
  }, [filter, query, rows]);

  const stats = useMemo(() => {
    const activeReturns = rows
      .map(({ item }) => item.latest?.vsEntryPct)
      .filter((v): v is number => v != null);
    const avgReturn =
      activeReturns.length > 0
        ? activeReturns.reduce((sum, v) => sum + v, 0) / activeReturns.length
        : null;
    return {
      total: rows.length,
      hot: rows.filter((r) => r.level.key === 'hot').length,
      warm: rows.filter((r) => r.level.key === 'warm').length,
      risk: rows.filter((r) => r.level.key === 'risk').length,
      held: rows.filter((r) => r.held).length,
      avgReturn,
    };
  }, [rows]);

  return (
    <main className="page page--workspace">
      <header className="page-header">
        <h1 className="page-title">跟踪池</h1>
        <p className="page-description">
          管理消息雷达、研报和手动加入的观察标的，按等级筛出需要复核、等待信号或已经进入模拟盘的股票。
        </p>
      </header>

      <section className="watchlist-workbench-metrics" aria-label="跟踪池概览">
        <Metric label="跟踪标的" value={`${stats.total} 只`} />
        <Metric label="红/蓝钻" value={`${stats.hot}/${stats.warm}`} />
        <Metric label="已进模拟盘" value={`${stats.held} 只`} />
        <Metric label="回撤复核" value={`${stats.risk} 只`} />
        <Metric label="平均自加入" value={fmtPct(stats.avgReturn)} tone={stats.avgReturn} />
      </section>

      <section className="watchlist-workbench-controls">
        <div className="watchlist-workbench-tabs" role="tablist" aria-label="跟踪池筛选">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`watchlist-workbench-tab${filter === item.key ? ' watchlist-workbench-tab--active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="watchlist-workbench-search">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索代码或名称"
          />
          <button type="button" className="button button-secondary" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </section>

      {loading && <div className="list-loading">加载跟踪池…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && filteredRows.length === 0 && (
        <div className="empty-state">当前筛选下没有标的。</div>
      )}

      {!loading && !error && filteredRows.length > 0 && (
        <section className="section watchlist-workbench-table">
          <div className="table-scroll-wrap">
            <table className="candidate-table">
              <thead>
                <tr>
                  <th>标的</th>
                  <th>等级</th>
                  <th>状态</th>
                  <th>今日</th>
                  <th>自加入</th>
                  <th>加入信息</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ item, level, held, age }) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/watchlist/${item.id}`} className="watchlist-workbench-symbol">
                        <strong>{item.name}</strong>
                        <span>{item.symbol}</span>
                      </Link>
                      {item.reason && (
                        <p className="watchlist-workbench-reason">{item.reason}</p>
                      )}
                    </td>
                    <td>
                      <span className={`watchlist-panel-level ${level.className}`}>
                        {level.label}
                      </span>
                    </td>
                    <td>
                      <span className={held ? 'watchlist-workbench-status watchlist-workbench-status--held' : 'watchlist-workbench-status'}>
                        {held ? '已进模拟盘' : level.status}
                      </span>
                    </td>
                    <td className={pctClassName(item.latest?.pctChg)}>
                      {fmtPct(item.latest?.pctChg)}
                    </td>
                    <td className={pctClassName(item.latest?.vsEntryPct)}>
                      {fmtPct(item.latest?.vsEntryPct)}
                    </td>
                    <td>
                      <div className="watchlist-workbench-entry">
                        <span>{sourceLabel(item.sourceType)}</span>
                        <span>
                          {item.entryDate ?? '-'}
                          {age != null ? ` · ${age} 天` : ''}
                        </span>
                        <span>加入价 {fmtPrice(item.entryPrice)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="watchlist-workbench-actions">
                        <Link href={`/watchlist/${item.id}`} className="saved-link">
                          详情
                        </Link>
                        <Link href={`/research?symbol=${item.symbol}`} className="saved-link">
                          研报
                        </Link>
                        <Link href={`/demo/stock/${item.symbol}`} className="saved-link">
                          图表
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number | null;
}) {
  return (
    <div className="watchlist-workbench-metric">
      <span>{label}</span>
      <strong className={tone == null ? undefined : pctClassName(tone)}>{value}</strong>
    </div>
  );
}
