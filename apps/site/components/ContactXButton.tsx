'use client';

import { siteConfig, getFeedbackTweetUrl } from '@/lib/site-config';
import { track } from '@/lib/analytics';

type ContactXButtonProps = {
  source: string;
  variant?: 'primary' | 'ghost';
  size?: 'default' | 'sm';
  children?: React.ReactNode;
  useTweetIntent?: boolean;
};

export function ContactXButton({
  source,
  variant = 'ghost',
  size = 'default',
  children,
  useTweetIntent = false,
}: ContactXButtonProps) {
  const href = useTweetIntent ? getFeedbackTweetUrl() : siteConfig.contactXUrl;
  const className = [
    'btn',
    variant === 'primary' ? 'btn--primary' : 'btn--ghost',
    size === 'sm' ? 'btn--sm' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('contact_x_click', { source })}
    >
      {children ?? '在 X 上联系'}
    </a>
  );
}
