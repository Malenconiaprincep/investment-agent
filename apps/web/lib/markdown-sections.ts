export type MarkdownSection = {
  id: string;
  title: string;
  content: string;
};

const DISCLAIMER_RE = /\n*免责声明[：:][\s\S]*$/;

function slugify(title: string, index: number): string {
  const slug = title.replace(/\s+/g, '-').slice(0, 32);
  return slug || `section-${index}`;
}

/** 按 ## 标题拆分 Markdown，用于分块渲染 */
export function splitMarkdownSections(source: string): MarkdownSection[] {
  const trimmed = source.trim();
  if (!trimmed) return [];

  const sections: MarkdownSection[] = [];
  const lines = trimmed.split('\n');
  let title = '';
  let bodyLines: string[] = [];

  const flush = () => {
    let body = bodyLines.join('\n').trim();
    if (!title && !body) return;

    if (!title && body.startsWith('## ')) {
      const firstLine = body.split('\n')[0] ?? '';
      title = firstLine.replace(/^##\s+/, '').trim();
      body = body.slice(firstLine.length).trim();
    }

    if (title.toLowerCase().includes('免责声明')) return;

    body = body.replace(DISCLAIMER_RE, '').trim();
    if (!title && body) {
      title = '市场解读';
    }
    if (!body && !title) return;

    sections.push({
      id: slugify(title, sections.length),
      title,
      content: body,
    });
  };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      flush();
      title = match[1].trim();
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

export function extractMarkdownDisclaimer(source: string): string | null {
  const match = source.trim().match(DISCLAIMER_RE);
  return match ? match[0].trim() : null;
}
