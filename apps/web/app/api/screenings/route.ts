import { NextResponse } from 'next/server';
import { runAgentCoreScreeningsJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export type ScreeningSummary = {
  id: string;
  query: string;
  hotThemes: string[];
  mode: 'auto' | 'manual';
  passed: boolean;
  elapsedMs: number | null;
  createdAt: string;
  sectorCount: number;
  candidateCount: number;
};

export async function GET() {
  try {
    const stdout = await runAgentCoreScreeningsJson(['list']);
    const sessions = JSON.parse(stdout) as ScreeningSummary[];
    return NextResponse.json({ sessions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取选股历史失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
