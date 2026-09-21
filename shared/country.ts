/**
 * Turning a release country code into something recognisable at a glance.
 *
 * Where a disc was pressed is one of the things worth knowing about a physical
 * copy, so it appears on the tile as well as in the detail view. A bare "SE" is
 * not recognisable while scanning a shelf; a flag is.
 */

/** MusicBrainz uses this pseudo-code for a release with no single territory. */
export const WORLDWIDE = 'XW';

/** MusicBrainz also uses these region pseudo-codes, which have no real flag. */
const PSEUDO_COUNTRIES: Record<string, string> = {
  XW: 'Worldwide',
  XE: 'Europe',
  XU: 'Unknown territory',
  XC: 'Czechoslovakia',
  XG: 'East Germany',
  YU: 'Yugoslavia',
  SU: 'Soviet Union',
};

/**
 * Converts an ISO 3166-1 alpha-2 code to its regional-indicator flag.
 *
 * Returns null for pseudo-codes like `XW`, and for anything that is not two
 * ASCII letters, so callers can fall back to a neutral badge rather than
 * rendering the mojibake that a bogus code produces.
 */
export function countryFlag(code: string | null): string | null {
  if (code === null) return null;
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  if (upper in PSEUDO_COUNTRIES) return null;

  // Regional indicator symbols live at U+1F1E6 ('A') through U+1F1FF ('Z').
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  const LETTER_A = 'A'.charCodeAt(0);
  // Indexed rather than spread: the code is already validated as two ASCII
  // letters, and spreading a string invites surrogate-pair bugs elsewhere.
  const first = REGIONAL_INDICATOR_A + (upper.charCodeAt(0) - LETTER_A);
  const second = REGIONAL_INDICATOR_A + (upper.charCodeAt(1) - LETTER_A);
  return String.fromCodePoint(first, second);
}

/**
 * The human-readable country name for a code.
 *
 * Uses `Intl.DisplayNames` where available so we do not ship a country table,
 * falling back to the bare code. Pseudo-codes are named explicitly because
 * `Intl` does not know them.
 */
export function countryName(code: string | null, locale = 'en'): string | null {
  if (code === null) return null;
  const upper = code.trim().toUpperCase();
  if (upper.length === 0) return null;

  const pseudo = PSEUDO_COUNTRIES[upper];
  if (pseudo !== undefined) return pseudo;

  if (!/^[A-Z]{2}$/.test(upper)) return upper;

  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return names.of(upper) ?? upper;
  } catch {
    // Intl.DisplayNames is missing or the locale is unsupported.
    return upper;
  }
}

/**
 * What the UI shows for a disc's origin: a flag when there is one, the code as a
 * short label, and a full name for the accessible description and tooltip.
 */
export interface CountryDisplay {
  flag: string | null;
  code: string;
  name: string;
  /** True when this is a region pseudo-code rather than an actual country. */
  isRegion: boolean;
}

export function countryDisplay(code: string | null, locale = 'en'): CountryDisplay | null {
  if (code === null || code.trim().length === 0) return null;
  const upper = code.trim().toUpperCase();

  return {
    flag: countryFlag(upper),
    code: upper,
    name: countryName(upper, locale) ?? upper,
    isRegion: upper in PSEUDO_COUNTRIES,
  };
}
