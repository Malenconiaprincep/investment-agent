import { redirect } from 'next/navigation';

type PageProps = {
  searchParams: Promise<{ symbol?: string }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (params.symbol) {
    redirect(`/research?symbol=${encodeURIComponent(params.symbol)}`);
  }
  redirect('/monitor');
}
