'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ContactXButton } from '@/components/ContactXButton';
import { track } from '@/lib/analytics';
import type { ReleaseAsset, ReleaseInfo } from '@/lib/releases';
import { formatFileSize } from '@/lib/releases';

type DetectedOs = 'mac' | 'win' | 'other';

function detectOs(): DetectedOs {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() ?? '';
  if (platform.includes('mac') || ua.includes('mac')) return 'mac';
  if (platform.includes('win') || ua.includes('win')) return 'win';
  return 'other';
}

const platformLabels: Record<ReleaseAsset['platform'], string> = {
  mac: 'macOS',
  'win-x64': 'Windows 64 位 (x64)',
  'win-arm64': 'Windows ARM64',
  'win-portable': 'Windows 便携版 (x64)',
  other: '其他',
};

const platformDescriptions: Record<ReleaseAsset['platform'], string> = {
  mac: '适用于 Apple Silicon 与 Intel Mac（dmg / zip）',
  'win-x64': '适用于常见 Intel / AMD 台式机与笔记本（最常见）',
  'win-arm64': '适用于骁龙笔记本、Surface Pro X 等 ARM 设备',
  'win-portable': '免安装便携版，适合 U 盘或受限环境',
  other: '',
};

function isHighlighted(platform: ReleaseAsset['platform'], os: DetectedOs): boolean {
  if (os === 'mac') return platform === 'mac';
  if (os === 'win') return platform === 'win-x64';
  return false;
}

type DownloadCardProps = {
  asset: ReleaseAsset;
  releaseTag: string;
  highlighted: boolean;
};

function DownloadCard({ asset, releaseTag, highlighted }: DownloadCardProps) {
  return (
    <article
      className={`download-card${highlighted ? ' download-card--highlight' : ''}`}
    >
      <div className="download-card-header">
        <div>
          <h3 className="download-card-title">
            {platformLabels[asset.platform]}
            {highlighted && (
              <span
                style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.75rem',
                  color: 'var(--accent)',
                }}
              >
                推荐
              </span>
            )}
          </h3>
          <p className="download-card-meta">
            {platformDescriptions[asset.platform]}
          </p>
        </div>
        <span className="download-card-meta">{formatFileSize(asset.size)}</span>
      </div>
      <p className="download-card-meta" style={{ fontFamily: 'monospace' }}>
        {asset.name}
      </p>
      <div className="download-card-actions">
        <a
          href={asset.browserDownloadUrl}
          className="btn btn--primary btn--sm"
          download
          onClick={() =>
            track('download_click', {
              platform: asset.platform,
              version: releaseTag,
            })
          }
        >
          下载 {releaseTag}
        </a>
      </div>
    </article>
  );
}

type DownloadClientProps = {
  release: ReleaseInfo | null;
};

export function DownloadClient({ release }: DownloadClientProps) {
  const [os, setOs] = useState<DetectedOs>('other');

  useEffect(() => {
    setOs(detectOs());
  }, []);

  if (!release || release.assets.length === 0) {
    return (
      <div className="release-empty">
        <p style={{ margin: '0 0 1rem' }}>
          暂无可下载的安装包。Beta 版本发布后将在此页提供 macOS 与 Windows
          安装包下载。
        </p>
        <p style={{ margin: 0 }}>
          如需提前获取安装包，请在{' '}
          <ContactXButton source="download_empty" size="sm" /> 上联系我们。
        </p>
      </div>
    );
  }

  const orderedPlatforms: ReleaseAsset['platform'][] = [
    'mac',
    'win-x64',
    'win-arm64',
    'win-portable',
  ];

  const sortedAssets = [...release.assets].sort(
    (a, b) =>
      orderedPlatforms.indexOf(a.platform) - orderedPlatforms.indexOf(b.platform),
  );

  return (
    <>
      <p className="download-card-meta" style={{ marginBottom: '1rem' }}>
        最新版本：<strong style={{ color: 'var(--text)' }}>{release.tagName}</strong>
        {release.publishedAt && (
          <>
            {' '}
            · 发布于{' '}
            {new Date(release.publishedAt).toLocaleDateString('zh-CN')}
          </>
        )}
      </p>

      <div className="download-grid">
        {sortedAssets.map((asset) => (
          <DownloadCard
            key={asset.browserDownloadUrl}
            asset={asset}
            releaseTag={release.tagName}
            highlighted={isHighlighted(asset.platform, os)}
          />
        ))}
      </div>
    </>
  );
}

export function DownloadContactCta() {
  return (
    <div className="contact-cta" style={{ marginTop: '2rem' }}>
      安装遇到问题？请在 <ContactXButton source="download_page" size="sm" />{' '}
      上联系我们。
    </div>
  );
}
