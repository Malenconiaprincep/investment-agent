import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { LOCAL_AUTH_COOKIE, parseAuthSession } from '@/lib/local-auth';
import { defaultNavPath } from '@/lib/nav-items';

type RegisterPageProps = {
  searchParams?: Promise<{
    error?: string;
    msg?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const cookieStore = await cookies();
  const session = await parseAuthSession(cookieStore.get(LOCAL_AUTH_COOKIE)?.value);
  if (session) {
    redirect(defaultNavPath(session.permissions, session.role));
  }

  const params = await searchParams;
  const hasTakenError = params?.error === '1';
  const hasValidationError = params?.error === '2';
  const hasServerError = params?.error === '3';
  const message = params?.msg;

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="register-title">
        <div className="login-copy">
          <h1 id="register-title">注册</h1>
          <p>
            创建免费账号即可使用单股分析、跟踪池等基础功能。消息雷达、回测等高级能力需管理员开通权限。
          </p>
        </div>

        <form className="login-form" action="/api/auth/register" method="post">
          <label className="form-field">
            <span>账号</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              placeholder="3–32 位字母、数字或下划线"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]{3,32}"
              required
            />
          </label>

          <label className="form-field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="至少 8 位"
              required
            />
          </label>

          <label className="form-field">
            <span>确认密码</span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          {hasTakenError ? (
            <p className="form-error" role="alert">
              该账号已被注册，请直接登录或换一个账号。
            </p>
          ) : null}

          {hasValidationError ? (
            <p className="form-error" role="alert">
              {message ?? '请检查账号和密码格式。'}
            </p>
          ) : null}

          {hasServerError ? (
            <p className="form-error" role="alert">
              {message ?? '注册服务暂不可用，请稍后重试。'}
            </p>
          ) : null}

          <button className="button login-submit" type="submit">
            创建账号
          </button>
        </form>

        <p className="login-hints muted">
          已有账号？<Link href="/login">返回登录</Link>
        </p>
      </section>
    </main>
  );
}
