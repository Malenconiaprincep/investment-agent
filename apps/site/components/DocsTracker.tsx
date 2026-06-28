'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';

export function DocsTracker({ slug }: { slug: string }) {
  useEffect(() => {
    track('docs_view', { slug });
  }, [slug]);

  return null;
}
