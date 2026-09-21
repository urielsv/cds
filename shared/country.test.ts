import { describe, expect, it } from 'vitest';

import { countryDisplay, countryFlag, countryName } from './country';

describe('countryFlag', () => {
  it('converts a real country code to its flag', () => {
    expect(countryFlag('AR')).toBe('🇦🇷');
    expect(countryFlag('JP')).toBe('🇯🇵');
    expect(countryFlag('GB')).toBe('🇬🇧');
  });

  it('accepts lowercase and surrounding whitespace', () => {
    expect(countryFlag('ar')).toBe('🇦🇷');
    expect(countryFlag(' jp ')).toBe('🇯🇵');
  });

  it('returns null for MusicBrainz region pseudo-codes', () => {
    // XW is very common on digital releases and has no flag; rendering one
    // would be actively misleading.
    expect(countryFlag('XW')).toBeNull();
    expect(countryFlag('XE')).toBeNull();
  });

  it('returns null rather than mojibake for malformed codes', () => {
    expect(countryFlag(null)).toBeNull();
    expect(countryFlag('')).toBeNull();
    expect(countryFlag('ARG')).toBeNull();
    expect(countryFlag('1A')).toBeNull();
  });
});

describe('countryName', () => {
  it('resolves real country codes to names', () => {
    expect(countryName('AR')).toBe('Argentina');
    expect(countryName('JP')).toBe('Japan');
  });

  it('names the pseudo-codes Intl does not know', () => {
    expect(countryName('XW')).toBe('Worldwide');
    expect(countryName('XE')).toBe('Europe');
    expect(countryName('SU')).toBe('Soviet Union');
  });

  it('falls back to the bare code for anything unrecognised', () => {
    expect(countryName('ZZZ')).toBe('ZZZ');
  });

  it('returns null for absent input', () => {
    expect(countryName(null)).toBeNull();
    expect(countryName('')).toBeNull();
  });
});

describe('countryDisplay', () => {
  it('gives a flag, code and name for a real country', () => {
    expect(countryDisplay('AR')).toEqual({
      flag: '🇦🇷',
      code: 'AR',
      name: 'Argentina',
      isRegion: false,
    });
  });

  it('marks a region so the UI can style it differently', () => {
    expect(countryDisplay('XW')).toEqual({
      flag: null,
      code: 'XW',
      name: 'Worldwide',
      isRegion: true,
    });
  });

  it('returns null when a disc has no recorded country', () => {
    expect(countryDisplay(null)).toBeNull();
    expect(countryDisplay('   ')).toBeNull();
  });
});
