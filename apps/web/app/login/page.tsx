import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isValidLocalSession, LOCAL_AUTH_COOKIE } from '@/lib/local-auth';

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cookieStore = await cookies();
  const session = cookieStore.get(LOCAL_AUTH_COOKIE)?.value;
  if (isValidLocalSession(session)) {
    redirect('/');
  }

  const params = await searchParams;
  const hasError = params?.error === '1';

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="site-brand-mark" aria-hidden>
            IA
          </span>
          <span>投研助手</span>
        </div>

        <div className="login-copy">
          <h1 id="login-title">本地登录</h1>
          <p>请输入本地账号密码后继续使用。当前原型账号为 admin / admin。</p>
        </div>

        <form className="login-form" action="/api/auth/login" method="post">
          <label className="form-field">
            <span>账号</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              defaultValue="admin"
              required
            />
          </label>

          <label className="form-field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              defaultValue="admin"
              required
            />
          </label>

          {hasError ? (
            <p className="form-error" role="alert">
              账号或密码不正确，请使用 admin / admin。
            </p>
          ) : null}

          <button className="button login-submit" type="submit">
            进入系统
          </button>
        </form>
      </section>
    </main>
  );
}
