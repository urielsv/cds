import { describe, expect, it } from 'vitest';

import { looksLong } from './introTiming';

describe('looksLong', () => {
  it('waits before predicting', () => {
    expect(looksLong(0, 10, 200)).toBe(false);
  });

  it('predicts from the rate covers have arrived at so far', () => {
    expect(looksLong(2, 10, 1000)).toBe(true); // ~5 s in total
    expect(looksLong(8, 10, 1000)).toBe(false); // ~1.25 s in total
  });

  it('treats nothing arriving as slow, and anything past the limit as long', () => {
    expect(looksLong(0, 10, 600)).toBe(true);
    expect(looksLong(9, 10, 3000)).toBe(true);
  });

  it('is never long once everything is in', () => {
    expect(looksLong(10, 10, 900)).toBe(false);
  });
});
