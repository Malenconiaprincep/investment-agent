export type ReleaseAsset = {
  name: string;
  browserDownloadUrl: string;
  size: number;
  platform: 'mac' | 'win-x64' | 'win-arm64' | 'win-portable' | 'other';
};

export type ReleaseInfo = {
  tagName: string;
  name: string;
  publishedAt: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
};

function classifyAsset(name: string): ReleaseAsset['platform'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dmg') || (lower.endsWith('.zip') && lower.includes('mac'))) {
    return 'mac';
  }
  if (lower.includes('portable') && lower.endsWith('.exe')) {
    return 'win-portable';
  }
  if (lower.includes('setup') && lower.includes('arm64') && lower.endsWith('.exe')) {
    return 'win-arm64';
  }
  if (lower.includes('setup') && lower.includes('x64') && lower.endsWith('.exe')) {
    return 'win-x64';
  }
  return 'other';
}

function parseRelease(data: unknown): ReleaseInfo | null {
  if (!data || typeof data !== 'object') return null;
  const release = data as {
    tag_name?: string;
    name?: string;
    published_at?: string;
    html_url?: string;
    assets?: Array<{
      name?: string;
      browser_download_url?: string;
      size?: number;
    }>;
  };

  if (!release.tag_name || !release.html_url) return null;

  const assets: ReleaseAsset[] = (release.assets ?? [])
    .filter((a) => a.name && a.browser_download_url)
    .map((a) => ({
      name: a.name!,
      browserDownloadUrl: a.browser_download_url!,
      size: a.size ?? 0,
      platform: classifyAsset(a.name!),
    }))
    .filter((a) => a.platform !== 'other');

  return {
    tagName: release.tag_name,
    name: release.name ?? release.tag_name,
    publishedAt: release.published_at ?? '',
    htmlUrl: release.html_url,
    assets,
  };
}

export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const repoUrl = process.env.NEXT_PUBLIC_GITHUB_REPO ??
    'https://github.com/Malenconiaprincep/investment-agent';
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;

  const apiUrl = `https://api.github.com/repos/${match[1]}/releases/latest`;

  try {
    const res = await fetch(apiUrl, {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    return parseRelease(await res.json());
  } catch {
    return null;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}
