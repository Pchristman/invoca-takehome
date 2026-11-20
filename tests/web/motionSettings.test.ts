import { describe, expect, it } from 'vitest';
import {
  MOTION_OFF,
  parseDuration,
  parseEase,
  readMotionCss,
  resolveMotion,
} from '../../src/web/models/motionSettings';

const REAL = { fast: '150ms', base: '200ms', slow: '300ms', ease: 'cubic-bezier(0.2, 0, 0, 1)' };

describe('parseDuration', () => {
  it.each([
    ['200ms', 0.2],
    ['0ms', 0],
    ['0.3s', 0.3],
    [' 150ms ', 0.15],
  ])('reads %j as %d seconds', (text, seconds) => {
    expect(parseDuration(text)).toBeCloseTo(seconds, 10);
  });

  it.each(['', 'fast', '-5ms', 'NaNms', '200'])('rejects %j', (text) => {
    expect(parseDuration(text)).toBeNull();
  });
});

describe('parseEase', () => {
  it('reads a cubic-bezier, with or without spaces', () => {
    expect(parseEase('cubic-bezier(0.2, 0, 0, 1)')).toEqual([0.2, 0, 0, 1]);
    expect(parseEase('cubic-bezier(0.2,0,0,1)')).toEqual([0.2, 0, 0, 1]);
  });

  it.each(['ease', 'cubic-bezier(1,2,3)', 'cubic-bezier(a,b,c,d)'])('rejects %j', (text) => {
    expect(parseEase(text)).toBeNull();
  });
});

describe('resolveMotion', () => {
  it('is on, in seconds, for the real token strings', () => {
    expect(resolveMotion({ reduced: false, ...REAL })).toEqual({
      enabled: true,
      fast: 0.15,
      base: 0.2,
      slow: 0.3,
      ease: [0.2, 0, 0, 1],
    });
  });

  it.each([
    ['reduced motion is on', { reduced: true, ...REAL }],
    ['a duration is 0ms (the reduced-motion token block)', { reduced: false, ...REAL, base: '0ms' }],
    ['a duration is empty', { reduced: false, ...REAL, fast: '' }],
    ['the ease is garbled', { reduced: false, ...REAL, ease: 'wobble' }],
  ])('is off when %s', (_name, input) => {
    expect(resolveMotion(input)).toEqual(MOTION_OFF);
  });

  it('MOTION_OFF is off with zero durations', () => {
    expect(MOTION_OFF).toEqual({ enabled: false, fast: 0, base: 0, slow: 0, ease: [0, 0, 1, 1] });
  });
});

describe('readMotionCss', () => {
  it('reads the four custom properties, trimmed', () => {
    const values: Record<string, string> = {
      '--motion-fast': ' 150ms',
      '--motion-base': '200ms ',
      '--motion-slow': ' 300ms ',
      '--ease-standard': ' cubic-bezier(0.2, 0, 0, 1) ',
    };
    const style = { getPropertyValue: (name: string) => values[name] ?? '' };
    expect(readMotionCss(style)).toEqual(REAL);
  });
});
