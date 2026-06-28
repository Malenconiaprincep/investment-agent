import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { LOCAL_AUTH_COOKIE, parseAuthSession } from '@/lib/local-auth';
import { defaultNavPath } from '@/lib/nav-items';

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    msg?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cookieStore = await cookies();
  const session = await parseAuthSession(cookieStore.get(LOCAL_AUTH_COOKIE)?.value);
  if (session) {
    redirect(defaultNavPath(session.permissions, session.role));
  }

  const params = await searchParams;
  const hasError = params?.error === '1';
  const hasActivateError = params?.error === '2';
  const hasServerError = params?.error === '3';
  const serverMessage = params?.msg;
  const activateMessage = params?.msg;

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-copy">
          <h1 id="login-title">登录</h1>
          <p>使用你的账号登录。不同账号拥有不同功能权限，Token 可在登录后配置。</p>
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
              placeholder="请输入账号"
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

          {hasServerError ? (
            <p className="form-error" role="alert">
              {serverMessage ?? '登录服务暂不可用，请稍后重试。'}
            </p>
          ) : null}

          <button className="button login-submit" type="submit">
            进入系统
          </button>
        </form>

        <p className="login-hints muted">
          还没有账号？<Link href="/register">立即注册</Link>
        </p>
        <p className="login-hints muted">
          如需升级权限（如回测），请联系管理员。
        </p>
      </section>
    </main>
  );
}
