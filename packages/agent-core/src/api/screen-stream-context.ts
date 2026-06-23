import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScreenStreamEvent } from './screen-stream-types.js';

type ScreenStreamEmitter = (event: ScreenStreamEvent) => void;

const screenStreamEmitterStorage = new AsyncLocalStorage<ScreenStreamEmitter>();

export function withScreenStreamEmitter<T>(
  emit: ScreenStreamEmitter,
  fn: () => Promise<T>,
): Promise<T> {
  return screenStreamEmitterStorage.run(emit, fn);
}

export function emitScreenStreamEvent(event: ScreenStreamEvent): void {
  screenStreamEmitterStorage.getStore()?.(event);
}
