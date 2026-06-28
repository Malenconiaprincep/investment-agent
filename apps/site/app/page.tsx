import Link from 'next/link';
import { BetaBadge } from '@/components/BetaBadge';
import { ContactXButton } from '@/components/ContactXButton';
import { FeatureIcon, type FeatureIconName } from '@/components/FeatureIcon';
import { HeroMockup } from '@/components/HeroMockup';

const features: Array<{
  icon: FeatureIconName;
  title: string;
  description: string;
}> = [
  {
    icon: 'report',
    title: '单股研报',
    description:
      '五步 Workflow 自动生成结构化研报，采数、撰写、质检全程可见。',
  },
  {
    icon: 'screen',
    title: '自动选股',
    description: '问财筛选 + 钻石信号 + 因子打分，投委会多维度分析候选池。',
  },
  {
    icon: 'radar',
    title: '消息雷达',
    description: '盘中扫描新闻催化，自动识别热点并加入跟踪池。',
  },
  {
    icon: 'watchlist',
    title: '跟踪池',
    description: '日快照、周评回顾，持仓与信号变化一目了然。',
  },
  {
    icon: 'paper',
    title: '模拟盘',
    description: 'ETF / 股票双仓模拟，验证策略而不动用真实资金。',
  },
  {
    icon: 'backtest',
    title: 'ETF 与回测',
    description: '尾盘策略、动量轮动，Walk-forward 与鲁棒性检验。',
  },
];

const stats = [
  { value: '100%', label: '本地运行' },
  { value: '6+', label: '投研模块' },
  { value: 'Beta', label: '开放测试' },
];

export default function HomePage() {
  return (
    <>
      <section className="landing-hero">
        <div className="landing-hero__inner">
          <div className="landing-hero__copy">
            <div className="hero-eyebrow">
              <BetaBadge />
              <span className="hero-eyebrow__text">本地优先 · 自管 API Key</span>
            </div>

            <h1 className="hero-title">A 股 AI 投研工作台</h1>
            <p className="hero-lead">
              输入股票代码，几分钟拿到结构化研报；自动扫描热点、模拟验证策略。
              桌面版安装即用，数据与密钥留在你的设备上。
            </p>

            <div className="hero-actions">
              <Link href="/download" className="btn btn--primary btn--lg">
                免费下载桌面版
              </Link>
              <Link href="/docs/quickstart" className="btn btn--ghost btn--lg">
                安装教程
              </Link>
            </div>

            <div className="hero-stats">
              {stats.map((s) => (
                <div key={s.label} className="hero-stat">
                  <span className="hero-stat__value">{s.value}</span>
                  <span className="hero-stat__label">{s.label}</span>
                </div>
              ))}
            </div>

            <p className="disclaimer-banner">
              仅供<strong>学习与研究</strong>，不构成投资建议。详见{' '}
              <Link href="/docs/disclaimer">免责声明</Link>。
            </p>
          </div>

          <div className="landing-hero__visual">
            <HeroMockup />
          </div>
        </div>
      </section>

      <div className="page-container">
        <section className="landing-section">
          <div className="section-header">
            <p className="section-kicker">核心功能</p>
            <h2 className="section-title">一套工具，覆盖投研全流程</h2>
            <p className="section-desc">
              从单股初研到策略回测，Workflow 编排让每一步可追溯、可验证。
            </p>
          </div>
          <div className="feature-grid">
            {features.map((f, i) => (
              <article
                key={f.title}
                className="feature-card"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <FeatureIcon name={f.icon} />
                <h3>{f.title}</h3>
                <p>{f.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="section-header">
            <p className="section-kicker">下载</p>
            <h2 className="section-title">选择你的平台</h2>
            <p className="section-desc">
              macOS 与 Windows 一键安装，无需配置开发环境。
            </p>
          </div>
          <div className="platform-grid">
            <Link href="/download" className="platform-card">
              <span className="platform-card__icon" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
              </span>
              <h3>macOS</h3>
              <p>Apple Silicon 与 Intel，dmg / zip 安装包</p>
              <span className="platform-card__cta">下载 →</span>
            </Link>
            <Link href="/download" className="platform-card">
              <span className="platform-card__icon" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 5.5L10.5 4v15.09L3 20.5V5.5zm18 0v15l-7.5 1.41V4L21 5.5zM10.5 4L21 5.5v15l-10.5 1.5V4z" />
                </svg>
              </span>
              <h3>Windows</h3>
              <p>x64、ARM64 安装包与便携版</p>
              <span className="platform-card__cta">下载 →</span>
            </Link>
            <Link href="/docs/quickstart" className="platform-card platform-card--muted">
              <span className="platform-card__icon platform-card__icon--muted" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 6v6l4 2" strokeLinecap="round" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </span>
              <h3>安装后配置</h3>
              <p>登录账号、配置 DeepSeek Key，即可开始</p>
              <span className="platform-card__cta">查看教程 →</span>
            </Link>
          </div>
        </section>

        <section className="cta-band">
          <div className="cta-band__copy">
            <h2>Beta 阶段，欢迎试用与反馈</h2>
            <p>遇到 Bug 或有功能建议，直接在 X 上联系我们。</p>
          </div>
          <div className="cta-band__actions">
            <Link href="/download" className="btn btn--primary">
              下载桌面版
            </Link>
            <ContactXButton source="home_cta" variant="ghost" />
            <Link href="/feedback" className="btn btn--ghost btn--sm">
              反馈说明
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
