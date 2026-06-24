'use client';

import { useState } from 'react';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';

type AddToWatchlistButtonProps = {
  symbol: string;
  name: string;
  reason?: string;
  sourceType?: 'report' | 'screening' | 'manual' | 'signal';
  sourceId?: string;
};

export function AddToWatchlistButton({
  symbol,
  name,
  reason,
  sourceType = 'manual',
  sourceId,
}: AddToWatchlistButtonProps) {
  const { setOpen, refresh } = useWatchlistPanel();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, name, reason, sourceType, sourceId }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? '添加失败');
      }
      setDone(true);
      refresh();
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <button
        type="button"
        className="button button-secondary"
        onClick={() => setOpen(true)}
      >
        已加入跟踪池 · 查看
      </button>
    );
  }

  return (
    <div className="inline-actions">
      <button
        type="button"
        className="button button-secondary"
        disabled={loading}
        onClick={handleAdd}
      >
        {loading ? '添加中…' : '加入自选'}
      </button>
      {error && <span className="muted">{error}</span>}
    </div>
  );
}
