import { NextResponse } from 'next/server';
import { runAgentCoreMonitorJson } from '@/lib/agent-core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  try {
    const stdout = await runAgentCoreMonitorJson(['status']);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取监控状态失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const json = (await request.json().catch(() => ({}))) as { action?: string };
    if (json.action === 'ack' && request.url) {
      const id = new URL(request.url).searchParams.get('id');
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 });
      }
      const stdout = await runAgentCoreMonitorJson(['ack', id]);
      return NextResponse.json(JSON.parse(stdout));
    }

    const force = json.action === 'force';
    const stdout = await runAgentCoreMonitorJson(['poll', ...(force ? ['--force'] : [])]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : '监控扫描失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
