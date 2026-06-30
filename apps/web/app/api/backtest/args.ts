export function getBacktestArgsFromSearchParams(searchParams: URLSearchParams): string[] {
  const strategy = searchParams.get('strategy') ?? 'etf-momentum';
  const resolvedStrategy = strategy === 'stock' ? 'diamond-momentum' : strategy;

  if (resolvedStrategy === 'diamond' || resolvedStrategy === 'diamond-momentum') {
    const universe = searchParams.get('universe');
    const symbols = searchParams.get('symbols');
    if (!symbols && universe !== 'retail-stock') throw new Error('缺少 symbols 参数');
    const args = [
      resolvedStrategy,
      symbols ?? 'all',
      searchParams.get('days') ?? '250',
      searchParams.get('holdDays') ?? '',
    ].filter((arg): arg is string => Boolean(arg));
    if (universe === 'retail-stock') args.push('--universe=retail-stock');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    if (startDate) args.push(`--from=${startDate}`);
    if (endDate) args.push(`--to=${endDate}`);
    return args;
  }

  if (strategy === 'screening') {
    const id = searchParams.get('id');
    if (!id) throw new Error('缺少 id 参数');
    return ['screening', id, searchParams.get('days') ?? 'auto'];
  }

  if (strategy === 'etf-momentum') {
    const args = ['etf-momentum', searchParams.get('days') ?? '365'];
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    if (startDate) args.push(`--from=${startDate}`);
    if (endDate) args.push(`--to=${endDate}`);
    const top = searchParams.get('top');
    const momentum = searchParams.get('momentum');
    const rebalance = searchParams.get('rebalance');
    const trendMa = searchParams.get('trendMa');
    if (top) args.push(`--top=${top}`);
    if (momentum) args.push(`--momentum=${momentum}`);
    if (rebalance) args.push(`--rebalance=${rebalance}`);
    if (trendMa) args.push(`--trend-ma=${trendMa}`);
    return args;
  }

  const args = [
    'etf',
    searchParams.get('days') ?? '250',
    searchParams.get('holdDays') ?? '',
  ].filter(Boolean);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  if (startDate) args.push(`--from=${startDate}`);
  if (endDate) args.push(`--to=${endDate}`);
  if (searchParams.get('includeWaitPullback') === '1') {
    args.push('--include-wait-pullback');
  }
  const maxFail = searchParams.get('maxFail');
  if (maxFail) args.push(`--max-fail=${maxFail}`);
  const exitMaxFail = searchParams.get('exitMaxFail');
  if (exitMaxFail) args.push(`--exit-max-fail=${exitMaxFail}`);
  const maxConcurrent = searchParams.get('maxConcurrent');
  if (maxConcurrent) args.push(`--max-concurrent=${maxConcurrent}`);
  const newsFilter = searchParams.get('newsFilter');
  if (newsFilter) args.push(`--news-filter=${newsFilter}`);
  const newsLookback = searchParams.get('newsLookback');
  if (newsLookback) args.push(`--news-lookback=${newsLookback}`);
  return args;
}
