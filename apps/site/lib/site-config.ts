export const siteConfig = {
  name: '投研助手',
  description:
    'A 股智能研报与热点选股工作台，帮助个人投资者快速完成研究。',
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0-beta',
  githubRepo:
    process.env.NEXT_PUBLIC_GITHUB_REPO ??
    'https://github.com/Malenconiaprincep/investment-agent',
  contactXUrl:
    process.env.NEXT_PUBLIC_CONTACT_X_URL ?? 'https://x.com/AISmart01',
} as const;

export function getXHandle(): string {
  try {
    const url = new URL(siteConfig.contactXUrl);
    const handle = url.pathname.replace(/^\//, '').split('/')[0];
    return handle ? `@${handle}` : '@your_handle';
  } catch {
    return '@your_handle';
  }
}

export function getFeedbackTweetUrl(): string {
  const handle = getXHandle().replace(/^@/, '');
  const text = encodeURIComponent(`@${handle} 投研助手 Beta 反馈：`);
  return `https://twitter.com/intent/tweet?text=${text}&hashtags=${encodeURIComponent('投研助手')}`;
}
