'use client';

import { track as vercelTrack } from '@vercel/analytics';

type EventProps = Record<string, string | number | boolean | null | undefined>;

export function track(event: string, props?: EventProps) {
  if (typeof window === 'undefined') return;
  vercelTrack(event, props);
}
