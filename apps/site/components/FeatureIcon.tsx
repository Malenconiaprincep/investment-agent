import type { ReactNode } from 'react';

const icons: Record<string, ReactNode> = {
  report: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 4h7l3 3v13H7V4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 4v3h3M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  screen: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M4 12h10M4 17h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="18" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  radar: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12L16 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  watchlist: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 6h14v12H5V6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 10h6M9 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  paper: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18V6l8-3 8 3v12l-8 3-8-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 3v18M4 6l8 3 8-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  backtest: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18h16M6 16l4-6 4 3 5-8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

export function FeatureIcon({ name }: { name: keyof typeof icons }) {
  return <span className="feature-icon">{icons[name]}</span>;
}

export type FeatureIconName = keyof typeof icons;
