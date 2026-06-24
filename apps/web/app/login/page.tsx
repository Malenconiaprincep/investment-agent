import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isValidLocalSession, LOCAL_AUTH_COOKIE } from '@/lib/local-auth';

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    msg?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cookieStore = await cookies();
  const session = cookieStore.get(LOCAL_AUTH_COOKIE)?.value;
  if (isValidLocalSession(session)) {
    redirect('/monitor');
  }

  const params = await searchParams;
  const hasError = params?.error === '1';
  const hasActivateError = params?.error === '2';
  const activateMessage = params?.msg;

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
          <h1 id="login-title">登录</h1>
          <p>
            管理员账号已预置 API Token；测试账号需登录后在「Token 设置」中自行配置。
          </p>
        </div>

        <form className="login-form" action="/api/auth/login" method="post">
          {params?.next ? (
            <input type="hidden" name="next" value={params.next} />
          ) : null}

          <label className="form-field">
            <span>账号</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              placeholder="adminwb 或 test"
              required
            />
          </label>

          <label className="form-field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {hasError ? (
            <p className="form-error" role="alert">
              账号或密码不正确。
            </p>
          ) : null}

          {hasActivateError ? (
            <p className="form-error" role="alert">
              登录成功但 Token 同步失败：{activateMessage ?? '未知错误'}
            </p>
          ) : null}

          <button className="button login-submit" type="submit">
            进入系统
          </button>
        </form>

        <div className="login-hints muted">
          <p>管理员：<code>adminwb</code>（Token 已预置）</p>
          <p>测试账号：<code>test</code> / <code>test123456</code>（需自行配置 Token）</p>
        </div>
      </section>
    </main>
  );
}
