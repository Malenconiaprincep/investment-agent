import '../config/load-env.js';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ETF_POOL } from '../data/etf/pool.js';
import { ETF_STABLE_V2_UNIVERSE } from '../data/etf/stable-universe.js';
import { auditFundEtfData } from '../data/market/local-csv/fund-etf-data.js';
import { PACKAGE_ROOT } from '../mastra/config/paths.js';

const audit = auditFundEtfData([
  ...ETF_POOL.map((item) => item.symbol),
  ...ETF_STABLE_V2_UNIVERSE.map((item) => item.symbol),
]);
const repoRoot = path.resolve(PACKAGE_ROOT, '../..');
const outputDir = path.join(repoRoot, 'docs/data-quality');
mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, 'fund-etf-data-20260710.json');
const markdownPath = path.join(outputDir, 'fund-etf-data-20260710.md');
writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf-8');
writeFileSync(markdownPath, [
  '# 基金ETF数据质量审计（2026-07-10）',
  '',
  `- ETF基础信息：${audit.metadataCount} 只（上市 ${audit.listedCount}、待上市 ${audit.pendingCount}、退市 ${audit.delistedCount}）`,
  `- 前复权日线：${audit.qfqFileCount} 只、${audit.qfqRowCount.toLocaleString('en-US')} 行`,
  `- 不复权日线：${audit.bfqFileCount} 只`,
  `- 独立退市行情：${audit.delistedHistoryFileCount} 只`,
  `- 最新交易日：${audit.latestTradeDate}，更新到该日 ${audit.latestFileCount} 只`,
  `- 异常OHLC：${audit.invalidOhlcRowCount} 行；零成交量：${audit.zeroVolumeRowCount} 行`,
  `- 当前策略池双口径缺失：${audit.strategyPoolMissing.length === 0 ? '无' : audit.strategyPoolMissing.join('、')}`,
  '',
  '## 使用规则',
  '',
  '- 前复权用于收益、均线和动量；不复权用于开盘成交、整手和最低佣金。',
  '- 非正OHLC、零成交量、上市不足252日或近20日平均成交额不足门槛的标的不可入选。',
  '- 退市ETF按当时真实存续区间进入历史股票池，禁止使用今天的存续列表回填过去。',
  '',
  '## 警告',
  '',
  ...audit.warnings.map((warning) => `- ${warning}`),
  '',
].join('\n'), 'utf-8');
process.stdout.write(JSON.stringify({ ...audit, jsonPath, markdownPath }, null, 2));
