import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appendEmbedQuery } from '@/lib/embed';
import { LOCAL_AUTH_COOKIE, parseAuthSession } from '@/lib/local-auth';
import { defaultNavPath } from '@/lib/nav-items';

type PageProps = {
  searchParams: Promise<{ symbol?: string; embed?: string }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const embed = params.embed === '1';

  if (params.symbol) {
    redirect(
      appendEmbedQuery(
        `/research?symbol=${encodeURIComponent(params.symbol)}`,
        embed,
      ),
    );
  }

  const cookieStore = await cookies();
  const session = await parseAuthSession(cookieStore.get(LOCAL_AUTH_COOKIE)?.value);
  redirect(
    appendEmbedQuery(
      session
        ? defaultNavPath(session.permissions, session.role)
        : defaultNavPath([], undefined),
      embed,
    ),
  );
}
