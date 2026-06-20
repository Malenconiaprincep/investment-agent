import type { ResearchStreamEvent } from './run-research-workflow-stream.js';

let currentEmitter: ((event: ResearchStreamEvent) => void) | null = null;

export function withResearchStreamEmitter<T>(
  emit: (event: ResearchStreamEvent) => void,
  fn: () => Promise<T>,
): Promise<T> {
  currentEmitter = emit;
  return fn().finally(() => {
    currentEmitter = null;
  });
}

export function emitResearchStreamEvent(event: ResearchStreamEvent): void {
  currentEmitter?.(event);
}
