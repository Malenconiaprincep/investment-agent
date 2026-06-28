'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function EmbedModeInner() {
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get('embed') === '1';

  useEffect(() => {
    document.body.classList.toggle('embed-mode', isEmbed);
    return () => {
      document.body.classList.remove('embed-mode');
    };
  }, [isEmbed]);

  return null;
}

export function EmbedMode() {
  return (
    <Suspense fallback={null}>
      <EmbedModeInner />
    </Suspense>
  );
}

export function useIsEmbedMode(): boolean {
  const searchParams = useSearchParams();
  return searchParams.get('embed') === '1';
}
