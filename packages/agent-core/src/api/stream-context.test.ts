import { describe, expect, it } from 'vitest';
import {
  emitCommitteeStreamEvent,
  withCommitteeStreamEmitter,
} from './committee-stream-context.js';
import {
  emitResearchStreamEvent,
  withResearchStreamEmitter,
} from './research-stream-context.js';
import {
  emitScreenStreamEvent,
  withScreenStreamEmitter,
} from './screen-stream-context.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('stream emitter context', () => {
  it('isolates concurrent research streams', async () => {
    const first: string[] = [];
    const second: string[] = [];

    await Promise.all([
      withResearchStreamEmitter((event) => {
        if (event.type === 'token') first.push(event.text);
      }, async () => {
        await delay(10);
        emitResearchStreamEvent({ type: 'token', text: 'first' });
      }),
      withResearchStreamEmitter((event) => {
        if (event.type === 'token') second.push(event.text);
      }, async () => {
        emitResearchStreamEvent({ type: 'token', text: 'second-a' });
        await delay(20);
        emitResearchStreamEvent({ type: 'token', text: 'second-b' });
      }),
    ]);

    expect(first).toEqual(['first']);
    expect(second).toEqual(['second-a', 'second-b']);
  });

  it('isolates concurrent screen streams', async () => {
    const first: string[] = [];
    const second: string[] = [];

    await Promise.all([
      withScreenStreamEmitter((event) => {
        if (event.type === 'token') first.push(event.text);
      }, async () => {
        await delay(10);
        emitScreenStreamEvent({ type: 'token', text: 'first' });
      }),
      withScreenStreamEmitter((event) => {
        if (event.type === 'token') second.push(event.text);
      }, async () => {
        emitScreenStreamEvent({ type: 'token', text: 'second-a' });
        await delay(20);
        emitScreenStreamEvent({ type: 'token', text: 'second-b' });
      }),
    ]);

    expect(first).toEqual(['first']);
    expect(second).toEqual(['second-a', 'second-b']);
  });

  it('isolates concurrent committee streams', async () => {
    const first: string[] = [];
    const second: string[] = [];

    await Promise.all([
      withCommitteeStreamEmitter((event) => {
        if (event.type === 'token') first.push(event.text);
      }, async () => {
        await delay(10);
        emitCommitteeStreamEvent({ type: 'token', text: 'first' });
      }),
      withCommitteeStreamEmitter((event) => {
        if (event.type === 'token') second.push(event.text);
      }, async () => {
        emitCommitteeStreamEvent({ type: 'token', text: 'second-a' });
        await delay(20);
        emitCommitteeStreamEvent({ type: 'token', text: 'second-b' });
      }),
    ]);

    expect(first).toEqual(['first']);
    expect(second).toEqual(['second-a', 'second-b']);
  });
});
