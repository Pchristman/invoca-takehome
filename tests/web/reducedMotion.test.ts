import { describe, expect, it } from 'vitest';
import { reducedMotionStore } from '../../src/web/models/reducedMotion';

function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener(_type: 'change', fn: () => void) {
      listeners.add(fn);
    },
    removeEventListener(_type: 'change', fn: () => void) {
      listeners.delete(fn);
    },
    set(next: boolean) {
      media.matches = next;
      for (const fn of [...listeners]) fn();
    },
    count: () => listeners.size,
  };
  return media;
}

describe('reducedMotionStore', () => {
  it('snapshot follows matches and subscribers hear each change', () => {
    const media = fakeMedia(false);
    const store = reducedMotionStore(() => media);
    let heard = 0;
    store.subscribe(() => heard++);
    expect(store.getSnapshot()).toBe(false);
    media.set(true);
    expect(heard).toBe(1);
    expect(store.getSnapshot()).toBe(true);
    media.set(false);
    expect(heard).toBe(2);
    expect(store.getSnapshot()).toBe(false);
  });

  it('accepts the media object directly', () => {
    expect(reducedMotionStore(fakeMedia(true)).getSnapshot()).toBe(true);
  });

  it('unsubscribe stops notifications', () => {
    const media = fakeMedia(false);
    const store = reducedMotionStore(() => media);
    let heard = 0;
    const unsubscribe = store.subscribe(() => heard++);
    unsubscribe();
    media.set(true);
    expect(heard).toBe(0);
    expect(media.count()).toBe(0);
  });

  it('missing matchMedia means not reduced, and subscribing is harmless', () => {
    const store = reducedMotionStore(() => undefined);
    expect(store.getSnapshot()).toBe(false);
    expect(() => store.subscribe(() => {})()).not.toThrow();
  });

  it('server snapshot is false', () => {
    expect(reducedMotionStore(fakeMedia(true)).getServerSnapshot()).toBe(false);
  });
});
