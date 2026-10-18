import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { resetSessionState } from '../src/lib/api';

// A file's first render loads its route's lazy chunks; under the gates' parallel load
// (`pnpm -r test` runs every package at once) that can take longer than the default 1 s
// of `findBy…` and `waitFor`. The test timeout (vite.config.ts) leaves room for it.
configure({ asyncUtilTimeout: 4_000 });

// jsdom lacks a few browser APIs that Radix primitives touch. (Node-environment
// tests such as bundle.test.ts have no DOM at all.)
const dom = typeof window !== 'undefined';
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
if (dom) {
  const elementProto = Element.prototype as unknown as Record<string, unknown>;
  const elementStubs: Record<string, () => unknown> = {
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  };
  for (const [name, stub] of Object.entries(elementStubs)) {
    if (typeof elementProto[name] !== 'function') elementProto[name] = stub;
  }
}
if (dom && typeof window.matchMedia !== 'function')
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;

afterEach(() => {
  if (dom) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSessionState();
});
