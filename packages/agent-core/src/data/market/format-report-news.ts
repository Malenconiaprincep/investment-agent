type NewsEntry = {
  datetime: string;
  title: string;
  url: string | null;
};

const TITLE_KEYS = [
  'title',
  'news_title',
  'name',
  'headline',
  'content_title',
  'doc_title',
] as const;

const URL_KEYS = [
  'url',
  'link',
  'pc_url',
  'news_url',
  'source_url',
  'jump_url',
  'web_url',
  'article_url',
] as const;

const TIME_KEYS = [
  'datetime',
  'time',
  'publish_time',
  'pub_time',
  'showDateTime',
  'date',
  'publish_date',
  'ctime',
] as const;

function pickString(
  obj: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return `https://finance.eastmoney.com${trimmed}`;
  }
  if (trimmed.startsWith('www.')) {
    return `https://${trimmed}`;
  }
  return null;
}

function normalizeDatetime(value: string | null): string {
  if (!value) return '';

  if (/^\d{13}$/.test(value)) {
    return new Date(Number(value)).toISOString();
  }

  if (/^\d{10}$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return value;
}

function formatDatetime(iso: string): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;

  return parsed.toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
}

function pushEntry(entries: NewsEntry[], entry: NewsEntry) {
  const title = entry.title.trim();
  if (!title) return;

  const duplicate = entries.some(
    (item) => item.title === title && item.url === entry.url,
  );
  if (!duplicate) {
    entries.push(entry);
  }
}

function walkIwencaiData(node: unknown, entries: NewsEntry[]) {
  if (Array.isArray(node)) {
    for (const item of node) {
      walkIwencaiData(item, entries);
    }
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const obj = node as Record<string, unknown>;
  const title = pickString(obj, TITLE_KEYS);
  const url = normalizeUrl(pickString(obj, URL_KEYS));
  const datetime = normalizeDatetime(pickString(obj, TIME_KEYS));

  if (title && (url || datetime)) {
    pushEntry(entries, { datetime, title, url });
  }

  for (const value of Object.values(obj)) {
    walkIwencaiData(value, entries);
  }
}

function extractLocalNewsItems(news: {
  items?: Array<{
    datetime?: string;
    title?: string;
    url?: string | null;
  }>;
}): NewsEntry[] {
  return (news.items ?? []).map((item) => ({
    datetime: normalizeDatetime(item.datetime ?? ''),
    title: String(item.title ?? '').trim(),
    url: normalizeUrl(item.url),
  }));
}

export function extractNewsEntries(news: unknown): NewsEntry[] {
  if (!news || typeof news !== 'object') {
    return [];
  }

  const record = news as Record<string, unknown>;

  if (record.dataSource === 'iwencai' && record.data != null) {
    const entries: NewsEntry[] = [];
    walkIwencaiData(record.data, entries);
    return entries.filter((item) => item.title);
  }

  if (Array.isArray(record.items)) {
    return extractLocalNewsItems(
      record as {
        items?: Array<{
          datetime?: string;
          title?: string;
          url?: string | null;
        }>;
      },
    ).filter((item) => item.title);
  }

  const entries: NewsEntry[] = [];
  walkIwencaiData(news, entries);
  return entries.filter((item) => item.title);
}

export function formatNewsMarkdown(news: unknown): string {
  const entries = extractNewsEntries(news);
  if (entries.length === 0) {
    return '暂无相关资讯。';
  }

  return entries
    .map((entry) => {
      const time = formatDatetime(entry.datetime);
      const prefix = time ? `${time} ` : '';
      if (entry.url) {
        const escapedTitle = entry.title.replace(/[\[\]]/g, '\\$&');
        return `- ${prefix}[${escapedTitle}](${entry.url})`;
      }
      return `- ${prefix}${entry.title}`;
    })
    .join('\n');
}
