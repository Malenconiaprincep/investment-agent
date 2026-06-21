'use client';

import { useState } from 'react';

type FeedbackSummary = {
  up: number;
  down: number;
  latest: { rating: 1 | -1 } | null;
};

type FeedbackButtonsProps = {
  targetType: 'report' | 'screening';
  targetId: string;
  initial?: FeedbackSummary;
};

export function FeedbackButtons({
  targetType,
  targetId,
  initial,
}: FeedbackButtonsProps) {
  const [summary, setSummary] = useState<FeedbackSummary>(
    initial ?? { up: 0, down: 0, latest: null },
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit(rating: 1 | -1) {
    setSubmitting(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, rating }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? '提交失败');
      }
      const payload = data as { summary: FeedbackSummary };
      setSummary(payload.summary);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="feedback-bar">
      <span className="muted">这条结果有帮助吗？</span>
      <button
        type="button"
        className={`chip ${summary.latest?.rating === 1 ? 'chip--active' : ''}`}
        disabled={submitting}
        onClick={() => submit(1)}
      >
        有用 {summary.up > 0 ? `(${summary.up})` : ''}
      </button>
      <button
        type="button"
        className={`chip ${summary.latest?.rating === -1 ? 'chip--active' : ''}`}
        disabled={submitting}
        onClick={() => submit(-1)}
      >
        需改进 {summary.down > 0 ? `(${summary.down})` : ''}
      </button>
    </div>
  );
}
