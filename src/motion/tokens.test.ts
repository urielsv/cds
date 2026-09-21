import { describe, expect, it } from 'vitest';

import { parseCssDuration, parseCubicBezier, transition } from './tokens';

describe('parseCssDuration', () => {
  it('parses milliseconds and seconds', () => {
    expect(parseCssDuration('240ms')).toBe(240);
    expect(parseCssDuration('0.24s')).toBe(240);
    expect(parseCssDuration(' 90ms ')).toBe(90);
  });

  it('rejects unitless and malformed values', () => {
    expect(parseCssDuration('240')).toBeNull();
    expect(parseCssDuration('fast')).toBeNull();
    expect(parseCssDuration('')).toBeNull();
  });
});

describe('parseCubicBezier', () => {
  it('parses the four control points', () => {
    expect(parseCubicBezier('cubic-bezier(0.2, 0, 0.13, 1)')).toEqual([0.2, 0, 0.13, 1]);
  });

  it('handles negative and overshooting values', () => {
    expect(parseCubicBezier('cubic-bezier(0.34, 1.56, 0.64, 1)')).toEqual([0.34, 1.56, 0.64, 1]);
  });

  it('rejects keywords and the wrong number of points', () => {
    expect(parseCubicBezier('ease-in-out')).toBeNull();
    expect(parseCubicBezier('cubic-bezier(0.2, 0, 0.13)')).toBeNull();
  });
});

describe('transition', () => {
  it('produces a Motion transition with seconds, falling back when tokens are absent', () => {
    // jsdom has no stylesheet loaded, so this exercises the fallback path.
    const t = transition('base');
    expect(t.duration).toBeCloseTo(0.24);
    expect(t.ease).toEqual([0.2, 0, 0.13, 1]);
  });

  it('selects the requested easing', () => {
    expect(transition('fast', 'springish').ease).toEqual([0.34, 1.56, 0.64, 1]);
  });
});
