import type { ResearchStreamEvent } from './run-research-workflow-stream.js';
import { AsyncLocalStorage } from 'node:async_hooks';

type ResearchStreamEmitter = (event: ResearchStreamEvent) => void;

const researchStreamEmitterStorage =
  new AsyncLocalStorage<ResearchStreamEmitter>();

export function withResearchStreamEmitter<T>(
  emit: ResearchStreamEmitter,
  fn: () => Promise<T>,
): Promise<T> {
  return researchStreamEmitterStorage.run(emit, fn);
}

export function emitResearchStreamEvent(event: ResearchStreamEvent): void {
  researchStreamEmitterStorage.getStore()?.(event);
}
