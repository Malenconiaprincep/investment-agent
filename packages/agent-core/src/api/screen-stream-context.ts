import type { ScreenStreamEvent } from './screen-stream-types.js';

let currentEmitter: ((event: ScreenStreamEvent) => void) | null = null;

export function withScreenStreamEmitter<T>(
  emit: (event: ScreenStreamEvent) => void,
  fn: () => Promise<T>,
): Promise<T> {
  currentEmitter = emit;
  return fn().finally(() => {
    currentEmitter = null;
  });
}

export function emitScreenStreamEvent(event: ScreenStreamEvent): void {
  currentEmitter?.(event);
}
