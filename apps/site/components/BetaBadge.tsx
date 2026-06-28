import { siteConfig } from '@/lib/site-config';

export function BetaBadge() {
  return <span className="beta-pill">Beta · {siteConfig.version}</span>;
}
