import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOCAL_AUTH_COOKIE, parseAuthSession } from '@/lib/local-auth';
import { defaultNavPath } from '@/lib/nav-items';

type PageProps = {
  searchParams: Promise<{ symbol?: string }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (params.symbol) {
    redirect(`/research?symbol=${encodeURIComponent(params.symbol)}`);
  }

  const cookieStore = await cookies();
  const session = await parseAuthSession(cookieStore.get(LOCAL_AUTH_COOKIE)?.value);
  redirect(
    session
      ? defaultNavPath(session.permissions, session.role)
      : '/research',
  );
}
