import type {
  TailEntryOutlookView,
  TailEntryRunView,
} from '@/components/TailEntryOutlookPanel';

/** 合并 SSE / done 事件中的明日预判状态，避免 done 用 null 覆盖已收到的 run */
export function resolveTailEntryDisplay(input: {
  run: TailEntryRunView | null | undefined;
  outlook: TailEntryOutlookView | null | undefined;
  fetchErrors?: string[];
  rotationSummary?: string;
  asOfDate?: string;
  screenCompleted?: boolean;
}): {
  run: TailEntryRunView | null;
  outlook: TailEntryOutlookView | null;
} {
  if (input.asOfDate) {
    return { run: null, outlook: null };
  }

  const outlook = input.outlook ?? null;
  let run = input.run ?? null;

  if (!run && outlook) {
    const hasData =
      outlook.sectorPicks.length > 0 || outlook.topInflowStocks.length > 0;
    run = {
      status: hasData ? 'success' : 'empty',
      message: hasData
        ? `已生成 ${outlook.sectorPicks.length} 个优先板块、${outlook.topInflowStocks.length} 只净流入龙头`
        : '明日预判已执行，但无符合条件的板块或标的',
      sectorCount: outlook.sectorPicks.length,
      stockCount: outlook.topInflowStocks.length,
      nextTradeDate: outlook.nextTradeDate,
      ranAt: new Date().toISOString(),
    };
  }

  const tailEntryLine = input.fetchErrors?.find((item) =>
    item.startsWith('tail-entry:'),
  );
  if (!run && tailEntryLine) {
    const detail = tailEntryLine.replace(/^tail-entry:\s*/, '').trim();
    const success = detail.includes('明日预判') && /\d+\s*个板块/.test(detail);
    run = {
      status: success ? 'success' : 'failed',
      message: detail,
      sectorCount: 0,
      stockCount: 0,
      ranAt: new Date().toISOString(),
    };
  }

  const summary = input.rotationSummary ?? '';
  if (
    !run &&
    summary &&
    (summary.includes('## 明日板块预判') || summary.includes('## 尾盘参考标的'))
  ) {
    run = {
      status: 'success',
      message: '明日预判已生成，详见本卡片或下方「市场解读」',
      sectorCount: 0,
      stockCount: 0,
      ranAt: new Date().toISOString(),
    };
  }

  if (!run && input.screenCompleted) {
    run = {
      status: 'empty',
      message:
        '本次选股已完成，但未收到明日预判状态；请确认 agent-core 已重启后重试',
      sectorCount: 0,
      stockCount: 0,
      ranAt: new Date().toISOString(),
    };
  }

  return { run, outlook };
}
