import { redirect } from 'next/navigation';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function HistoryDetailRedirect({ params }: PageProps) {
  const { id } = await params;
  redirect(`/research?id=${encodeURIComponent(id)}`);
}
