import Link from 'next/link';
import '@/styles/auth.css';

export function AuthHeader() {
  return (
    <header className="auth-header">
      <div className="auth-header-inner">
        <Link href="/login" className="site-brand auth-header-brand">
          <span className="site-brand-mark" aria-hidden>
            IA
          </span>
          <span className="site-brand-text">投研助手</span>
        </Link>
      </div>
    </header>
  );
}
