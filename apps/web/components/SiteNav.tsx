import Link from 'next/link';

export function SiteNav() {
  return (
    <nav className="site-nav">
      <Link href="/" className="site-nav-brand">
        A股投研助手
      </Link>
      <div className="site-nav-links">
        <Link href="/">生成研报</Link>
        <Link href="/history">历史记录</Link>
      </div>
    </nav>
  );
}
