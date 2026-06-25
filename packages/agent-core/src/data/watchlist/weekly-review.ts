import {
  listLatestSnapshots,
  listWatchlistItems,
  listDiamondSignals,
  saveWeeklyReview,
} from './store.js';
import { listPaperTrades, getOrCreatePaperAccount, listPaperPositions } from '../paper/store.js';
import { getDailyQuote } from '../market/services.js';

function weekRange(date = new Date()) {
  const end = new Date(date);
  const start = new Date(date);
  start.setDate(end.getDate() - 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(start), weekEnd: fmt(end) };
}

export async function generateWeeklyReview() {
  const { weekStart, weekEnd } = weekRange();
  const items = await listWatchlistItems();
  const snapshots = await listLatestSnapshots();
  const diamonds = await listDiamondSignals(20);
  const account = await getOrCreatePaperAccount('stock');
  const positions = await listPaperPositions('stock');
  const trades = await listPaperTrades(20, 'stock');

  const snapshotMap = new Map(snapshots.map((s) => [s.symbol, s]));
  const returns = items
    .map((item) => {
      const snap = snapshotMap.get(item.symbol);
      return snap?.vsEntryPct ?? snap?.pctChg ?? null;
    })
    .filter((v): v is number => v != null);

  const avgReturnPct =
    returns.length > 0
      ? Number((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2))
      : null;

  let bestSymbol: string | null = null;
  let worstSymbol: string | null = null;
  let bestRet = Number.NEGATIVE_INFINITY;
  let worstRet = Number.POSITIVE_INFINITY;

  for (const item of items) {
    const snap = snapshotMap.get(item.symbol);
    const ret = snap?.vsEntryPct ?? snap?.pctChg;
    if (ret == null) continue;
    if (ret > bestRet) {
      bestRet = ret;
      bestSymbol = item.symbol;
    }
    if (ret < worstRet) {
      worstRet = ret;
      worstSymbol = item.symbol;
    }
  }

  const diamondRedCount = diamonds.filter((d) => d.strength === 'red').length;
  const diamondBlueCount = diamonds.filter((d) => d.strength === 'blue').length;

  let paperValue = account.cash;
  for (const pos of positions) {
    try {
      const q = await getDailyQuote(pos.symbol, 2);
      const price = q.latestClose ?? pos.avgCost;
      paperValue += pos.shares * price;
    } catch {
      paperValue += pos.shares * pos.avgCost;
    }
  }

  const paperReturnPct = Number(
    (((paperValue - account.initialCash) / account.initialCash) * 100).toFixed(2),
  );

  const lines: string[] = [
    `# 本周监控复盘（${weekStart} ~ ${weekEnd}）`,
    '',
    '## 监控池概览',
    `- 在监控 **${items.length}** 只`,
    avgReturnPct != null
      ? `- 相对加入价平均涨跌 **${avgReturnPct > 0 ? '+' : ''}${avgReturnPct}%**`
      : '- 暂无足够快照计算平均涨跌',
    bestSymbol != null
      ? `- 表现最好：**${bestSymbol}**（${bestRet > 0 ? '+' : ''}${bestRet.toFixed(2)}%）`
      : '',
    worstSymbol != null
      ? `- 表现最弱：**${worstSymbol}**（${worstRet > 0 ? '+' : ''}${worstRet.toFixed(2)}%）`
      : '',
    '',
    '## 钻石信号',
    `- 近期红钻 ${diamondRedCount} 次 · 蓝钻 ${diamondBlueCount} 次`,
    diamonds.length > 0
      ? diamonds
          .slice(0, 5)
          .map(
            (d) =>
              `- ${d.strength === 'red' ? '🔴' : '🔵'} ${d.name}（${d.symbol}）${d.tradeDate} · ${d.reasons[0] ?? ''}`,
          )
          .join('\n')
      : '- 本周暂无新信号',
    '',
    '## 模拟账户',
    `- 总资产约 **${paperValue.toFixed(0)}** 元（初始 ${account.initialCash.toFixed(0)}）`,
    `- 累计收益率 **${paperReturnPct > 0 ? '+' : ''}${paperReturnPct}%**`,
    `- 持仓 ${positions.length} 只 · 本周成交 ${trades.length} 笔`,
    '',
    '## 逐只快照',
  ];

  for (const item of items) {
    const snap = snapshotMap.get(item.symbol);
    if (!snap) {
      lines.push(`- **${item.name}**（${item.symbol}）：暂无最新快照`);
      continue;
    }
    const ret = snap.vsEntryPct ?? snap.pctChg;
    const diamond =
      snap.diamondStrength === 'red'
        ? ' 🔴红钻'
        : snap.diamondStrength === 'blue'
          ? ' 🔵蓝钻'
          : '';
    lines.push(
      `- **${item.name}**（${item.symbol}）收盘 ${snap.close.toFixed(2)}，${ret != null ? `${ret > 0 ? '+' : ''}${ret}%` : '—'}${diamond}`,
    );
    if (item.reason) {
      lines.push(`  - 关注理由：${item.reason.slice(0, 80)}`);
    }
  }

  lines.push(
    '',
    '## 免责声明',
    '以上内容基于公开行情与规则化信号自动生成，仅供学习研究，不构成投资建议。',
  );

  const content = lines.filter(Boolean).join('\n');
  const stats = {
    watchlistCount: items.length,
    avgReturnPct,
    bestSymbol,
    worstSymbol,
    diamondRedCount,
    diamondBlueCount,
  };

  return saveWeeklyReview({
    weekStart,
    weekEnd,
    title: `监控周报 ${weekStart}`,
    content,
    stats,
  });
}
