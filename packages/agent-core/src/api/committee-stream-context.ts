import type { CommitteeStreamEvent } from './committee-stream-types.js';

let currentEmitter: ((event: CommitteeStreamEvent) => void) | null = null;

export function withCommitteeStreamEmitter<T>(
  emit: (event: CommitteeStreamEvent) => void,
  fn: () => Promise<T>,
): Promise<T> {
  currentEmitter = emit;
  return fn().finally(() => {
    currentEmitter = null;
  });
}

export function emitCommitteeStreamEvent(event: CommitteeStreamEvent): void {
  currentEmitter?.(event);
}
