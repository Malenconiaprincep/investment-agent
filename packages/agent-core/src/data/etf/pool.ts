export type EtfPoolItem = {
  symbol: string;
  exchangeCode: `sh${string}` | `sz${string}`;
  name: string;
};

export const ETF_POOL_19: EtfPoolItem[] = [
  { exchangeCode: 'sh512880', symbol: '512880', name: '证券ETF' },
  { exchangeCode: 'sh512760', symbol: '512760', name: '科技ETF' },
  { exchangeCode: 'sh512010', symbol: '512010', name: '医药ETF' },
  { exchangeCode: 'sh512660', symbol: '512660', name: '军工ETF' },
  { exchangeCode: 'sh512800', symbol: '512800', name: '银行ETF' },
  { exchangeCode: 'sh515790', symbol: '515790', name: '光伏ETF' },
  { exchangeCode: 'sz159530', symbol: '159530', name: '机器人ETF' },
  { exchangeCode: 'sz159995', symbol: '159995', name: '券商ETF' },
  { exchangeCode: 'sh515980', symbol: '515980', name: '人工智能ETF' },
  { exchangeCode: 'sz159781', symbol: '159781', name: '新能源车ETF' },
  { exchangeCode: 'sh516160', symbol: '516160', name: '新能源ETF' },
  { exchangeCode: 'sz159808', symbol: '159808', name: '创业板成长ETF' },
  { exchangeCode: 'sz159920', symbol: '159920', name: '红利ETF' },
  { exchangeCode: 'sz159941', symbol: '159941', name: '纳指ETF' },
  { exchangeCode: 'sh513100', symbol: '513100', name: '纳指科技ETF' },
  { exchangeCode: 'sh513050', symbol: '513050', name: '中概互联ETF' },
  { exchangeCode: 'sh513500', symbol: '513500', name: '标普500ETF' },
  { exchangeCode: 'sh510300', symbol: '510300', name: '沪深300ETF' },
  { exchangeCode: 'sh512480', symbol: '512480', name: '国泰CES半导体ETF' },
];
