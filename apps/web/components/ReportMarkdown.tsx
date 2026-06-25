'use client';

import MDPreview from '@uiw/react-markdown-preview';
import '@uiw/react-markdown-preview/markdown.css';
import type { ComponentPropsWithoutRef } from 'react';

type ReportMarkdownProps = {
  source: string;
};

export function ReportMarkdown({ source }: ReportMarkdownProps) {
  return (
    <div className="report-markdown" data-color-mode="dark">
      <MDPreview
        source={source}
        components={{
          table: ({
            children,
            ...props
          }: ComponentPropsWithoutRef<'table'>) => (
            <div className="table-scroll-wrap markdown-table-wrap">
              <table className="markdown-table" {...props}>
                {children}
              </table>
            </div>
          ),
        }}
      />
    </div>
  );
}
