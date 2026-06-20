import { NextResponse } from 'next/server';
import { runAgentCoreJson } from '@/lib/agent-core';

export const runtime = 'nodejs';

export type ReportSummary = {
  id: string;
  symbol: string;
  name: string;
  passed: boolean;
  missingSections: string[];
  missingKeywords: string[];
  elapsedMs: number | null;
  createdAt: string;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') ?? undefined;
    const args = ['list'];

    if (symbol && /^\d{6}$/.test(symbol)) {
      args.push(symbol);
    }

    const stdout = await runAgentCoreJson(args);
    const reports = JSON.parse(stdout) as ReportSummary[];

    return NextResponse.json({ reports });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取历史研报失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
