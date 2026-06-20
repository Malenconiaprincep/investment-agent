export type MarketDataSource = 'eastmoney' | 'tencent';

export type DataMeta = {
  dataSource: MarketDataSource;
  asOf: string;
  cached: boolean;
  disclaimer: string;
};

export const MARKET_DISCLAIMER =
  '数据来自东方财富/腾讯公开接口，仅供学习研究，不构成投资建议。接口非官方授权，请控制请求频率。';
