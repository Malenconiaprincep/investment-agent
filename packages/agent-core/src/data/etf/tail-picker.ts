import { fetchIntradayQuotes } from '../market/free/intraday-quote.js';
import { getDailyQuote } from '../market/services.js';
import {
  formatTradeDate,
  getBeijingNow,
  isWeekday,
} from '../paper/trading-calendar.js';
import { ETF_POOL_19 } from './pool.js';
import {
  buildEtfTailPickCandidate,
  type EtfTailPickCandidate,
} from './rules.js';
import {
  saveEtfTailPickRun,
  type EtfTailPickRun,
  type EtfTailPickRunStatus,
} from './store.js';

export type RunEtfTailPickOptions = {
  force?: boolean;
  save?: boolean;
};

export type EtfTailPickResult = EtfTailPickRun & {
  errors: string[];
  poolSize: number;
  strictPicks: EtfTailPickCandidate[];
  nearPass: EtfTailPickCandidate[];
};

function buildSummary(input: {
  status: EtfTailPickRunStatus;
  passedCount: number;
  nearPassCount: number;
  poolSize: number;
}): string {
  if (input.status === 'skipped') {
    return '非工作日，跳过 ETF 尾盘推荐';
  }
  if (input.status === 'failed') {
    return 'ETF 尾盘推荐执行失败，未获得有效行情';
  }
  if (input.status === '0_PASS') {
    return `今日 0 只通过严格筛选，等待确定性机会；近通过 ${input.nearPassCount} 只`;
  }
  return `今日 ${input.passedCount}/${input.poolSize} 只 ETF 通过严格筛选，近通过 ${input.nearPassCount} 只`;
}

function sortCandidates(
  candidates: EtfTailPickCandidate[],
): EtfTailPickCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.failCount !== b.failCount) return a.failCount - b.failCount;
    if (a.dailyTurnover !== b.dailyTurnover) {
      return b.dailyTurnover - a.dailyTurnover;
    }
    return b.volumeRatio - a.volumeRatio;
  });
}

async function buildCandidate(
  poolItem: (typeof ETF_POOL_19)[number],
  quotes: Awaited<ReturnType<typeof fetchIntradayQuotes>>,
): Promise<EtfTailPickCandidate> {
  const daily = await getDailyQuote(poolItem.symbol, 90);
  const quote = quotes.get(poolItem.symbol);
  const latestClose = daily.latestClose ?? 0;
  const price = quote?.price ?? latestClose;
  const changePct = quote?.pctChg ?? daily.latestPctChg ?? 0;

  if (!price || price <= 0) {
    throw new Error('缺少有效价格');
  }

  return buildEtfTailPickCandidate({
    symbol: poolItem.symbol,
    exchangeCode: poolItem.exchangeCode,
    name: quote?.name || poolItem.name,
    price,
    changePct,
    dailyTurnover: quote?.amount ?? 0,
    intradayVolume: quote?.volume ?? null,
    bars: daily.quotes,
  });
}

function attachDerived(
  run: EtfTailPickRun,
  errors: string[],
  poolSize: number,
): EtfTailPickResult {
  return {
    ...run,
    errors,
    poolSize,
    strictPicks: run.candidates.filter((item) => item.status === 'passed'),
    nearPass: run.candidates.filter((item) => item.status === 'near_pass'),
  };
}

export async function runEtfTailPick(
  options: RunEtfTailPickOptions = {},
): Promise<EtfTailPickResult> {
  const started = Date.now();
  const now = getBeijingNow();
  const tradeDate = formatTradeDate(now);
  const generatedAt = new Date().toISOString();
  const save = options.save !== false;

  if (!options.force && !isWeekday(now)) {
    const runInput = {
      tradeDate,
      status: 'skipped' as const,
      summary: buildSummary({
        status: 'skipped',
        passedCount: 0,
        nearPassCount: 0,
        poolSize: ETF_POOL_19.length,
      }),
      generatedAt,
      elapsedMs: Date.now() - started,
      passedCount: 0,
      nearPassCount: 0,
      candidates: [],
    };
    const run = save
      ? await saveEtfTailPickRun(runInput)
      : { id: crypto.randomUUID(), ...runInput };
    return attachDerived(run, [], ETF_POOL_19.length);
  }

  const errors: string[] = [];
  const quotes = await fetchIntradayQuotes(ETF_POOL_19.map((item) => item.symbol));
  const candidates: EtfTailPickCandidate[] = [];

  for (const item of ETF_POOL_19) {
    try {
      candidates.push(await buildCandidate(item, quotes));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${item.exchangeCode} ${item.name}: ${message}`);
    }
  }

  const sorted = sortCandidates(candidates);
  const passedCount = sorted.filter((item) => item.status === 'passed').length;
  const nearPassCount = sorted.filter((item) => item.status === 'near_pass').length;
  const status: EtfTailPickRunStatus =
    sorted.length === 0 ? 'failed' : passedCount === 0 ? '0_PASS' : 'success';
  const runInput = {
    tradeDate,
    status,
    summary: buildSummary({
      status,
      passedCount,
      nearPassCount,
      poolSize: ETF_POOL_19.length,
    }),
    generatedAt,
    elapsedMs: Date.now() - started,
    passedCount,
    nearPassCount,
    candidates: sorted,
  };
  const run = save
    ? await saveEtfTailPickRun(runInput)
    : { id: crypto.randomUUID(), ...runInput };

  return attachDerived(run, errors, ETF_POOL_19.length);
}
