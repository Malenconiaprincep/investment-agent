import Link from 'next/link';
import {
  DownloadClient,
  DownloadContactCta,
} from '@/components/DownloadClient';
import { fetchLatestRelease } from '@/lib/releases';

export const metadata = {
  title: '下载',
};

export default async function DownloadPage() {
  const release = await fetchLatestRelease();

  return (
    <div className="page-container page-container--wide page-container--padded">
      <header className="page-hero">
        <p className="section-kicker">桌面版</p>
        <h1 className="page-hero__title">下载投研助手</h1>
        <p className="page-hero__lead">
          选择适合你系统的安装包。内置 Web 工作台与本地服务，安装后 API Key
          保存在你的设备上。
        </p>
      </header>

      <DownloadClient release={release} />

      <section className="landing-section" style={{ paddingTop: '2.5rem' }}>
        <div className="section-header">
          <h2 className="section-title">系统要求</h2>
        </div>
        <ul style={{ color: 'var(--muted)', fontSize: '0.9375rem', paddingLeft: '1.25rem', lineHeight: 1.7 }}>
          <li>macOS 11+（Apple Silicon 或 Intel）</li>
          <li>Windows 10/11 <strong style={{ color: 'var(--text)' }}>64 位</strong>（x64 或 ARM64）</li>
          <li>
            若安装时提示「需要 64 位 Windows」，说明当前为 32 位系统，需升级后安装 x64 版本
          </li>
          <li>
            网络：首次使用需配置 DeepSeek API Key（见{' '}
            <Link href="/docs/quickstart">安装教程</Link>）
          </li>
        </ul>
      </section>

      <section className="landing-section" style={{ paddingTop: '1.5rem' }}>
        <div className="section-header">
          <h2 className="section-title">安装后</h2>
          <p className="section-desc">
            安装完成后，请参考安装与配置教程完成登录与 API Key 设置。
          </p>
        </div>
        <div className="hero-actions" style={{ marginBottom: 0 }}>
          <Link href="/docs/quickstart" className="btn btn--ghost">
            安装与配置
          </Link>
          <Link href="/docs/features" className="btn btn--ghost">
            功能说明
          </Link>
        </div>
      </section>

      <DownloadContactCta />
    </div>
  );
}
