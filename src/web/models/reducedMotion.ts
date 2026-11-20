// The OS "reduce motion" setting as an external store for useSyncExternalStore.
// Pure: it takes a matchMedia-like object (or a function that returns one), so tests can fake it.

export interface MediaLike {
  matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export interface ReducedMotionStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): boolean;
  getServerSnapshot(): boolean;
}

export function reducedMotionStore(source: MediaLike | (() => MediaLike | undefined)): ReducedMotionStore {
  const media = (): MediaLike | undefined => (typeof source === 'function' ? source() : source);
  return {
    subscribe(onChange) {
      const query = media();
      if (!query) return () => {};
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    // No matchMedia means we cannot tell, so motion is not reduced.
    getSnapshot: () => media()?.matches ?? false,
    getServerSnapshot: () => false,
  };
}
