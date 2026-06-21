'use client';

import { useState } from 'react';

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
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <a href="/watchlist" className="button button-secondary">
        已加入自选 · 查看
      </a>
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
