export type TailEntryStockPick = {
  symbol: string;
  name: string;
  pctChg: number;
  netInflowWan: number;
  tierLabel: string;
  logic: string;
  riskNote?: string;
};

export type TailEntryOutlookView = {
  tradeDate: string;
  nextTradeDate: string;
  sectorPicks: Array<{
    name: string;
    pctChg: number;
    netInflowYi: number;
    priorityStars: number;
    logic: string;
    leaders: TailEntryStockPick[];
  }>;
  topInflowStocks: TailEntryStockPick[];
  plans: Array<{
    label: string;
    sectors: string[];
    symbols: string[];
    note: string;
  }>;
  watchSignals: string[];
  avoidSectors: Array<{ name: string; reason: string }>;
};

export type TailEntryRunView = {
  status: 'success' | 'failed' | 'skipped' | 'empty';
  message: string;
  sectorCount: number;
  stockCount: number;
  nextTradeDate?: string;
  ranAt: string;
};

function formatNextDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${Number(m)}月${Number(d)}日`;
}

function formatInflowWan(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 亿`;
  return `${Math.round(n)} 万`;
}

function formatNetInflowYi(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 0) return `${n.toFixed(1)} 亿`;
  return `-${Math.abs(n).toFixed(1)} 亿`;
}

function formatPctChg(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function stars(count: number): string {
  return '★'.repeat(Math.min(count, 5)) + '☆'.repeat(Math.max(0, 5 - count));
}

const STATUS_META: Record<
  TailEntryRunView['status'],
  { label: string; className: string }
> = {
  success: { label: '已完成', className: 'tail-entry-status--success' },
  empty: { label: '已执行 · 无合适数据', className: 'tail-entry-status--empty' },
  failed: { label: '已执行 · 数据不可用', className: 'tail-entry-status--failed' },
  skipped: { label: '已跳过', className: 'tail-entry-status--skipped' },
};

export function TailEntryOutlookPanel({
  run,
  outlook,
  loading = false,
  rotationSummary,
}: {
  run?: TailEntryRunView | null;
  outlook?: TailEntryOutlookView | null;
  loading?: boolean;
  /** 无结构化卡片时，提示用户到市场解读查看 markdown */
  rotationSummary?: string;
}) {
  if (loading) {
    return (
      <section className="pane-card insight-panel tail-entry-panel">
        <h2 className="section-title">明日预判 · 尾盘参考</h2>
        <p className="tail-entry-status tail-entry-status--loading">
          正在拉取东财板块与资金流向，生成明日预判…
        </p>
      </section>
    );
  }

  if (!run) return null;

  const meta = STATUS_META[run.status];
  const nextDate = formatNextDate(
    outlook?.nextTradeDate ?? run.nextTradeDate ?? '',
  );
  const showData =
    outlook &&
    (outlook.sectorPicks.length > 0 ||
      outlook.topInflowStocks.length > 0 ||
      outlook.plans.length > 0);
  const hasSummaryFallback =
    !showData &&
    Boolean(
      rotationSummary &&
        (rotationSummary.includes('## 明日板块预判') ||
          rotationSummary.includes('## 尾盘参考标的')),
    );

  return (
    <section className="pane-card insight-panel tail-entry-panel">
      <div className="tail-entry-head">
        <h2 className="section-title">
          明日预判 · 尾盘参考{nextDate ? `（${nextDate}）` : ''}
        </h2>
        <span className={`tail-entry-status ${meta.className}`}>
          {meta.label}
        </span>
      </div>

      <p className="tail-entry-message">{run.message}</p>

      {run.status !== 'skipped' && (
        <p className="muted tail-entry-note">
          说明：问财「候选池」与「明日预判」是两条独立链路；数据优先东财实时接口，失败时自动改用问财
          MCP。候选池为空只表示问财未筛出 60/120 日趋势股，不代表明日预判未运行。
        </p>
      )}

      {run.status === 'failed' && (
        <p className="muted">
          可稍后重试智能选股，或查看下方「市场解读」中的今日主线分析。
        </p>
      )}

      {hasSummaryFallback && (
        <p className="muted tail-entry-note">
          结构化卡片暂无数据，请向下滚动查看「市场解读」中的「明日板块预判」「尾盘参考标的」章节。
        </p>
      )}

      {showData && outlook && (
        <>
          {outlook.sectorPicks.length > 0 && (
            <>
              <h3 className="insight-block-title">优先板块</h3>
              <ul className="sector-list sector-list--compact">
                {outlook.sectorPicks.map((sector) => (
                  <li key={sector.name}>
                    <strong>{sector.name}</strong>
                    <span className="muted">
                      {' '}
                      · {stars(sector.priorityStars)} · 涨{' '}
                      {formatPctChg(sector.pctChg)} · 主力{' '}
                      {formatNetInflowYi(sector.netInflowYi)} ·{' '}
                      {sector.logic ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {outlook.topInflowStocks.length > 0 && (
            <>
              <h3 className="insight-block-title">全市场主力净流入</h3>
              <div className="tail-entry-stock-grid">
                {outlook.topInflowStocks.slice(0, 6).map((stock) => (
                  <div key={stock.symbol} className="tail-entry-stock-card">
                    <strong>
                      {stock.name}{' '}
                      <span className="candidate-card-code">{stock.symbol}</span>
                    </strong>
                    <span className="muted">
                      涨 {formatPctChg(stock.pctChg)} · 净流入{' '}
                      {formatInflowWan(stock.netInflowWan)} · {stock.tierLabel}
                    </span>
                    {stock.riskNote && (
                      <span className="tail-entry-risk">{stock.riskNote}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {outlook.plans.length > 0 && (
            <>
              <h3 className="insight-block-title">操作思路（研究用）</h3>
              <ul className="sector-list sector-list--compact">
                {outlook.plans.map((plan) => (
                  <li key={plan.label}>
                    <strong>{plan.label}</strong>
                    <span className="muted">
                      {' '}
                      — 板块 {plan.sectors.join('、') || '—'}；标的{' '}
                      {plan.symbols.join('、') || '—'}。{plan.note}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {outlook.avoidSectors.length > 0 && (
            <>
              <h3 className="insight-block-title">谨慎或回避</h3>
              <ul className="sector-list sector-list--compact">
                {outlook.avoidSectors.map((item) => (
                  <li key={item.name}>
                    <strong>{item.name}</strong>
                    <span className="muted"> — {item.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {outlook.watchSignals.length > 0 && (
            <>
              <h3 className="insight-block-title">明日开盘观察</h3>
              <ul className="sector-list sector-list--compact">
                {outlook.watchSignals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
