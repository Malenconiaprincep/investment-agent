import { AsyncLocalStorage } from 'node:async_hooks';
import type { CommitteeStreamEvent } from './committee-stream-types.js';

type CommitteeStreamEmitter = (event: CommitteeStreamEvent) => void;

const committeeStreamEmitterStorage =
  new AsyncLocalStorage<CommitteeStreamEmitter>();

export function withCommitteeStreamEmitter<T>(
  emit: CommitteeStreamEmitter,
  fn: () => Promise<T>,
): Promise<T> {
  return committeeStreamEmitterStorage.run(emit, fn);
}

export function emitCommitteeStreamEvent(event: CommitteeStreamEvent): void {
  committeeStreamEmitterStorage.getStore()?.(event);
}
