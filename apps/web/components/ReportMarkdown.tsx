'use client';

import MDPreview from '@uiw/react-markdown-preview';
import '@uiw/react-markdown-preview/markdown.css';

type ReportMarkdownProps = {
  source: string;
};

export function ReportMarkdown({ source }: ReportMarkdownProps) {
  return (
    <div className="report-markdown" data-color-mode="dark">
      <MDPreview source={source} />
    </div>
  );
}
