import { countryDisplay } from '@shared/country';

interface CountryBadgeProps {
  country: string | null;
  /** Set when the owner hand-corrected the country, so the UI can mark it. */
  isManual?: boolean;
  size?: 'tile' | 'detail';
}

/**
 * Shows where a disc was pressed.
 *
 * Origin is one of the things worth knowing about a physical copy, so it appears
 * on the tile as well as in the detail view. The flag carries it at a glance
 * while scanning the shelf; the code and full name are there for anything a flag
 * cannot convey, including region pseudo-codes like `XW` that have no flag.
 */
export function CountryBadge({ country, isManual = false, size = 'tile' }: CountryBadgeProps) {
  const display = countryDisplay(country);
  if (!display) return null;

  const label = isManual ? `${display.name} (set manually)` : display.name;

  return (
    <span
      className={`country-badge country-badge--${size}${
        display.isRegion ? ' country-badge--region' : ''
      }${isManual ? ' country-badge--manual' : ''}`}
      title={label}
    >
      {display.flag !== null && (
        // The flag is decorative: the adjacent code carries the same information
        // as text, and screen readers announce flag emoji inconsistently.
        <span aria-hidden="true" className="country-badge__flag">
          {display.flag}
        </span>
      )}
      <span className="country-badge__code">{display.code}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
