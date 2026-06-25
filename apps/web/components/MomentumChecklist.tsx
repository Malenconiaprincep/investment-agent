type ChecklistItem = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
};

type MomentumChecklistProps = {
  checklist: ChecklistItem[];
  score: number;
  maxScore: number;
  action: 'buy' | 'hold' | 'wait' | 'sell';
  entryMemo?: string;
  stopLossPrice?: number | null;
  trailingStopPrice?: number | null;
  highWaterMark?: number | null;
};

const ACTION_LABEL: Record<MomentumChecklistProps['action'], string> = {
  buy: '可考虑买入',
  hold: '持有观察',
  wait: '等待信号',
  sell: '趋势转弱',
};

const ACTION_CLASS: Record<MomentumChecklistProps['action'], string> = {
  buy: 'momentum-action--buy',
  hold: 'momentum-action--hold',
  wait: 'momentum-action--wait',
  sell: 'momentum-action--sell',
};

export function MomentumChecklist({
  checklist,
  score,
  maxScore,
  action,
  entryMemo,
  stopLossPrice,
  trailingStopPrice,
  highWaterMark,
}: MomentumChecklistProps) {
  return (
    <section className="pane-card momentum-panel">
      <div className="momentum-panel-head">
        <h2 className="section-title">动量 Checklist</h2>
        <span className={`momentum-action ${ACTION_CLASS[action]}`}>
          {ACTION_LABEL[action]} · {score}/{maxScore}
        </span>
      </div>

      <ul className="momentum-checklist">
        {checklist.map((item) => (
          <li
            key={item.id}
            className={`momentum-checklist-item${item.passed ? ' momentum-checklist-item--pass' : ''}`}
          >
            <span className="momentum-check" aria-hidden>
              {item.passed ? '✓' : '○'}
            </span>
            <span>
              {item.label}
              {item.detail ? <span className="muted"> · {item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {entryMemo && <p className="momentum-memo">{entryMemo}</p>}
      {stopLossPrice != null && (
        <p className="muted momentum-stop">
          建议止损价 <strong>{stopLossPrice.toFixed(2)}</strong>（-8%）
        </p>
      )}
      {trailingStopPrice != null && trailingStopPrice > 0 && (
        <p className="muted momentum-stop">
          移动止盈参考 <strong>{trailingStopPrice.toFixed(2)}</strong>
          {highWaterMark != null ? `（自高点 ${highWaterMark.toFixed(2)} 回撤 12%）` : '（自高点回撤 12%）'}
        </p>
      )}
    </section>
  );
}
