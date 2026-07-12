export type StableEtfAssetClass =
  | 'equity_core'
  | 'equity_tactical'
  | 'gold'
  | 'bond'
  | 'cash';

export type StableEtfUniverseItem = {
  symbol: string;
  exchangeCode: `sh${string}` | `sz${string}`;
  name: string;
  assetClass: StableEtfAssetClass;
  riskCluster: string;
  maxWeight: number;
};

/**
 * ETF Stable V2 的固定、可审计投资范围。
 *
 * 同一指数只保留一只代表性产品，避免把高度相关的 ETF 误当成分散持仓。
 * 新标的不能在回测后直接加入默认池，必须先记录 changeset 并重新跑全量验证。
 */
export const ETF_STABLE_V2_UNIVERSE: ReadonlyArray<StableEtfUniverseItem> = [
  {
    exchangeCode: 'sh510300',
    symbol: '510300',
    name: '沪深300ETF',
    assetClass: 'equity_core',
    riskCluster: 'china_large_cap',
    maxWeight: 0.6,
  },
  {
    exchangeCode: 'sh513500',
    symbol: '513500',
    name: '标普500ETF',
    assetClass: 'equity_core',
    riskCluster: 'us_equity',
    maxWeight: 0.35,
  },
  {
    exchangeCode: 'sh513100',
    symbol: '513100',
    name: '纳指ETF',
    assetClass: 'equity_core',
    riskCluster: 'us_equity',
    maxWeight: 0.3,
  },
  {
    exchangeCode: 'sz159920',
    symbol: '159920',
    name: '恒生ETF',
    assetClass: 'equity_core',
    riskCluster: 'hong_kong_equity',
    maxWeight: 0.3,
  },
  {
    exchangeCode: 'sh513520',
    symbol: '513520',
    name: '日经ETF华夏',
    assetClass: 'equity_core',
    riskCluster: 'japan_equity',
    maxWeight: 0.25,
  },
  {
    exchangeCode: 'sh512880',
    symbol: '512880',
    name: '证券ETF',
    assetClass: 'equity_tactical',
    riskCluster: 'brokerage',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh512480',
    symbol: '512480',
    name: '半导体ETF国联安',
    assetClass: 'equity_tactical',
    riskCluster: 'semiconductor',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh512010',
    symbol: '512010',
    name: '医药ETF',
    assetClass: 'equity_tactical',
    riskCluster: 'healthcare',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh512800',
    symbol: '512800',
    name: '银行ETF',
    assetClass: 'equity_tactical',
    riskCluster: 'banking',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh515790',
    symbol: '515790',
    name: '光伏ETF',
    assetClass: 'equity_tactical',
    riskCluster: 'solar',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh512660',
    symbol: '512660',
    name: '军工ETF',
    assetClass: 'equity_tactical',
    riskCluster: 'defense',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh516160',
    symbol: '516160',
    name: '新能源ETF',
    assetClass: 'equity_tactical',
    riskCluster: 'new_energy',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh515980',
    symbol: '515980',
    name: '人工智能ETF',
    assetClass: 'equity_tactical',
    riskCluster: 'artificial_intelligence',
    maxWeight: 0.2,
  },
  {
    exchangeCode: 'sh518880',
    symbol: '518880',
    name: '黄金ETF',
    assetClass: 'gold',
    riskCluster: 'gold',
    maxWeight: 0.25,
  },
  {
    exchangeCode: 'sh511010',
    symbol: '511010',
    name: '国债ETF',
    assetClass: 'bond',
    riskCluster: 'government_bond_medium',
    maxWeight: 0.5,
  },
  {
    exchangeCode: 'sh511260',
    symbol: '511260',
    name: '十年国债ETF',
    assetClass: 'bond',
    riskCluster: 'government_bond_long',
    maxWeight: 0.4,
  },
  {
    exchangeCode: 'sh511880',
    symbol: '511880',
    name: '银华日利ETF',
    assetClass: 'cash',
    riskCluster: 'cash',
    maxWeight: 1,
  },
];

export const ETF_STABLE_V2_CASH_SYMBOL = '511880';
export const ETF_STABLE_V2_BENCHMARK_SYMBOL = '510300';

export function isStableRiskAsset(assetClass: StableEtfAssetClass): boolean {
  return assetClass === 'equity_core' || assetClass === 'equity_tactical';
}

export function isStableDefensiveAsset(assetClass: StableEtfAssetClass): boolean {
  return assetClass === 'gold' || assetClass === 'bond' || assetClass === 'cash';
}
