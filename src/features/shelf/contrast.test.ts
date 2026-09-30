import { describe, expect, it } from 'vitest';

import { isDark } from './contrast';

describe('isDark', () => {
  it('calls black and deep colours dark', () => {
    expect(isDark('#000000')).toBe(true);
    expect(isDark('#223344')).toBe(true);
    expect(isDark('#8b1a1a')).toBe(true);
  });

  it('calls white and pale colours light', () => {
    expect(isDark('#ffffff')).toBe(false);
    expect(isDark('#ececee')).toBe(false);
    expect(isDark('#f2d479')).toBe(false);
  });

  it('treats anything unparseable as light', () => {
    expect(isDark('rebeccapurple')).toBe(false);
    expect(isDark('#abc')).toBe(false);
  });
});
