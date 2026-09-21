import { describe, expect, it } from 'vitest';

import {
  barcodeSearchVariants,
  discSlug,
  formatDuration,
  normaliseBarcode,
  releaseYear,
  totalRuntimeMs,
} from './format';

describe('formatDuration', () => {
  it('renders minutes and zero-padded seconds', () => {
    expect(formatDuration(320357)).toBe('5:20');
    expect(formatDuration(65000)).toBe('1:05');
  });

  it('renders hours only when the runtime exceeds one hour', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('falls back to an em dash when MusicBrainz has no timing data', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('releaseYear', () => {
  it('handles full, month and year-only MusicBrainz dates', () => {
    expect(releaseYear('2001-03-12')).toBe(2001);
    expect(releaseYear('2001-03')).toBe(2001);
    expect(releaseYear('2001')).toBe(2001);
  });

  it('returns null for missing or unparseable dates', () => {
    expect(releaseYear(null)).toBeNull();
    expect(releaseYear('')).toBeNull();
  });
});

describe('totalRuntimeMs', () => {
  it('sums the track lengths', () => {
    expect(totalRuntimeMs([{ lengthMs: 1000 }, { lengthMs: 2000 }])).toBe(3000);
  });

  it('returns null when any track is untimed, so the UI can hide the total', () => {
    expect(totalRuntimeMs([{ lengthMs: 1000 }, { lengthMs: null }])).toBeNull();
  });
});

describe('discSlug', () => {
  it('builds an artist-title-year slug', () => {
    expect(discSlug('Daft Punk', 'Discovery', '2001-03-12')).toBe('daft-punk-discovery-2001');
  });

  it('folds diacritics so accented names stay stable', () => {
    expect(discSlug('Sigur Rós', 'Ágætis byrjun', '1999')).toBe('sigur-ros-agaetis-byrjun-1999');
    expect(discSlug('Mötley Crüe', 'Dr. Feelgood', '1989')).toBe('motley-crue-dr-feelgood-1989');
  });

  it('transliterates letters Unicode cannot decompose', () => {
    // These are distinct letters, not accented vowels, so NFD leaves them be.
    expect(discSlug('Sigur Rós', 'Ágætis', null)).toContain('agaetis');
    expect(discSlug('Blø', 'Døgnvill', null)).toBe('blo-dognvill');
    expect(discSlug('Einstürzende', 'Straße', null)).toBe('einsturzende-strasse');
  });

  it('collapses punctuation rather than leaving stray separators', () => {
    expect(discSlug('AC/DC', 'Back in Black!', '1980')).toBe('ac-dc-back-in-black-1980');
  });

  it('omits the year when the date is unknown', () => {
    expect(discSlug('Boards of Canada', 'Twoism', null)).toBe('boards-of-canada-twoism');
  });
});

describe('normaliseBarcode', () => {
  it('strips the spacing that appears on a printed barcode', () => {
    expect(normaliseBarcode('7 24384 96065 0')).toBe('724384960650');
  });

  it('accepts EAN-8, UPC-A, EAN-13 and ITF-14 lengths', () => {
    expect(normaliseBarcode('12345670')).toBe('12345670');
    expect(normaliseBarcode('724384960650')).toBe('724384960650');
    expect(normaliseBarcode('0724384960650')).toBe('0724384960650');
    expect(normaliseBarcode('07243849606501')).toBe('07243849606501');
  });

  it('rejects lengths that are not a real barcode', () => {
    expect(normaliseBarcode('12345')).toBeNull();
    expect(normaliseBarcode('')).toBeNull();
    expect(normaliseBarcode('abc')).toBeNull();
  });
});

describe('barcodeSearchVariants', () => {
  it('queries both UPC-A and its zero-padded EAN-13 form', () => {
    // MusicBrainz stores this CD as the bare 12-digit UPC. Its search index
    // happens to normalise the leading zero, but we do not rely on that.
    expect(barcodeSearchVariants('724384960650')).toEqual(['724384960650', '0724384960650']);
  });

  it('strips a leading zero from an EAN-13 to recover the UPC-A form', () => {
    expect(barcodeSearchVariants('0724384960650')).toEqual(['0724384960650', '724384960650']);
  });

  it('leaves a genuine EAN-13 alone', () => {
    expect(barcodeSearchVariants('5099750442227')).toEqual(['5099750442227']);
  });

  it('returns nothing for an unusable input', () => {
    expect(barcodeSearchVariants('nope')).toEqual([]);
  });
});
