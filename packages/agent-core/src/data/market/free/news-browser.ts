import { toMarketCode } from './http.js';

type NewsBulletinResponse = {
  gszx?: {
    data?: {
      items?: Array<{
        title?: string;
        showDateTime?: number;
        url?: string;
        summary?: string;
      }>;
    };
  };
};

export type BrowserNewsItem = {
  datetime: string;
  title: string;
  source: string | null;
  url: string | null;
};

function mapBrowserNews(
  json: NewsBulletinResponse,
  cutoff: Date,
): BrowserNewsItem[] {
  const items = json.gszx?.data?.items ?? [];

  return items
    .filter((item) => {
      if (!item.showDateTime) {
        return true;
      }
      return new Date(item.showDateTime) >= cutoff;
    })
    .slice(0, 10)
    .map((item) => ({
      datetime: item.showDateTime
        ? new Date(item.showDateTime).toISOString()
        : '',
      title: String(item.title ?? ''),
      source: null,
      url: item.url != null ? String(item.url) : null,
    }));
}

export async function fetchNewsBrowser(
  symbol: string,
  days: number,
): Promise<{ data: BrowserNewsItem[] }> {
  let playwright: typeof import('playwright');
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error(
      'Browser 兜底需要 playwright：在 agent-core 目录执行 pnpm add playwright && pnpm exec playwright install chromium',
    );
  }

  const code = toMarketCode(symbol);
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/NewsBulletin/PageAjax?code=${code}`;
  const browser = await playwright.chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    const response = await context.request.get(url, {
      headers: {
        Referer: 'https://emweb.securities.eastmoney.com/',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok()) {
      throw new Error(`Browser 请求新闻失败: HTTP ${response.status()}`);
    }

    const json = (await response.json()) as NewsBulletinResponse;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return { data: mapBrowserNews(json, cutoff) };
  } finally {
    await browser.close();
  }
}
