import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { REDUCED_TRANSITION, transition } from '@/motion/tokens';
import {
  activeFilterCount,
  EMPTY_FILTERS,
  type FacetKey,
  type Facets,
  type FacetValue,
  type Filters,
  foldText,
} from '@shared/collection';
import { countryDisplay } from '@shared/country';

interface FilterPanelProps {
  facets: Facets;
  filters: Filters;
  onChange: (filters: Filters) => void;
  matchCount: number;
  totalCount: number;
  onClose: () => void;
  /** Owner sign-in entry, placed at the foot of the panel out of the way. */
  footer?: ReactNode;
}

/** Long facets show this many values until expanded. */
const COLLAPSED_COUNT = 14;

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

interface ChipGroupProps<T extends string | number> {
  title: string;
  values: readonly FacetValue<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  render?: (value: T) => ReactNode;
  /** Offer a text box to narrow the chips; worth it for artists and labels. */
  searchable?: boolean;
}

function ChipGroup<T extends string | number>({
  title,
  values,
  selected,
  onToggle,
  render,
  searchable = false,
}: ChipGroupProps<T>) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const [needle, setNeedle] = useState('');

  const visible = useMemo(() => {
    const folded = foldText(needle.trim());
    const filtered =
      folded.length === 0
        ? values
        : values.filter((facet) => foldText(String(facet.value)).includes(folded));
    if (expanded || folded.length > 0 || filtered.length <= COLLAPSED_COUNT) return filtered;
    // Selected values stay visible even when collapsed, so a choice never hides.
    const head = filtered.slice(0, COLLAPSED_COUNT);
    const extra = filtered.filter(
      (facet) => selected.includes(facet.value) && !head.includes(facet),
    );
    return [...head, ...extra];
  }, [values, expanded, needle, selected]);

  if (values.length === 0) return null;
  const hidden = values.length - visible.length;

  return (
    <section className="filter-panel__section" aria-labelledby={headingId}>
      <div className="filter-panel__section-head">
        <h3 id={headingId} className="filter-panel__section-title">
          {title}
        </h3>
        {selected.length > 0 && (
          <span className="filter-panel__section-count">{selected.length} selected</span>
        )}
      </div>
      {searchable && values.length > COLLAPSED_COUNT && (
        <input
          type="search"
          className="filter-panel__narrow"
          placeholder={`Find ${title.toLowerCase()}`}
          aria-label={`Find ${title.toLowerCase()}`}
          value={needle}
          onChange={(event) => {
            setNeedle(event.target.value);
          }}
        />
      )}
      <ul className="chips">
        {visible.map((facet) => {
          const active = selected.includes(facet.value);
          return (
            <li key={String(facet.value)}>
              <button
                type="button"
                className={`chip${active ? ' chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => {
                  onToggle(facet.value);
                }}
              >
                <span className="chip__label">{render ? render(facet.value) : facet.value}</span>
                <span className="chip__count" aria-label={`${String(facet.count)} albums`}>
                  {facet.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || expanded) && needle.length === 0 && (
        <button
          type="button"
          className="filter-panel__more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? 'Show fewer' : `Show ${String(hidden)} more`}
        </button>
      )}
    </section>
  );
}

const FACET_TITLES: Record<FacetKey, string> = {
  genres: 'Genre',
  artists: 'Artist',
  labels: 'Label',
  countries: 'Country',
  formats: 'Format',
};

/**
 * Every way to narrow the collection. Nothing here hides a disc: non-matching
 * covers are greyed out in place on the wall, so the collection keeps its shape
 * and the matches read as a pattern within it.
 */
export function FilterPanel({
  facets,
  filters,
  onChange,
  matchCount,
  totalCount,
  onClose,
  footer,
}: FilterPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = activeFilterCount(filters);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const years = useMemo(() => {
    if (facets.yearMin === null || facets.yearMax === null) return [];
    return Array.from(
      { length: facets.yearMax - facets.yearMin + 1 },
      (_, i) => (facets.yearMin ?? 0) + i,
    );
  }, [facets.yearMin, facets.yearMax]);

  const setFacet = (key: FacetKey, value: string) => {
    onChange({ ...filters, [key]: toggle(filters[key], value) });
  };

  return (
    <motion.aside
      id="filter-panel"
      className="filter-panel glass"
      role="dialog"
      aria-modal="false"
      aria-labelledby="filter-panel-title"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 40 }}
      transition={reduced ? REDUCED_TRANSITION : transition('slow', 'entrance')}
    >
      <header className="filter-panel__header">
        <div>
          <h2 id="filter-panel-title" className="filter-panel__title">
            Filters
          </h2>
          <p className="filter-panel__summary">
            {active === 0
              ? `${String(totalCount)} albums`
              : `${String(matchCount)} of ${String(totalCount)} match`}
          </p>
        </div>
        <div className="filter-panel__header-actions">
          {active > 0 && (
            <button
              type="button"
              className="filter-panel__reset"
              onClick={() => {
                onChange(EMPTY_FILTERS);
              }}
            >
              Reset
            </button>
          )}
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose}>
            <Icon name="close" size={18} />
            <span className="visually-hidden">Close filters</span>
          </button>
        </div>
      </header>

      <div className="filter-panel__body">
        <ChipGroup
          title="Decade"
          values={facets.decades}
          selected={filters.decades}
          onToggle={(decade) => {
            onChange({ ...filters, decades: toggle(filters.decades, decade) });
          }}
          render={(decade) => `${String(decade)}s`}
        />

        {years.length > 1 && (
          <section className="filter-panel__section" aria-labelledby="filter-year-title">
            <div className="filter-panel__section-head">
              <h3 id="filter-year-title" className="filter-panel__section-title">
                Release year
              </h3>
            </div>
            <div className="filter-panel__years">
              <label className="select">
                <span className="visually-hidden">From year</span>
                <select
                  value={filters.yearFrom ?? ''}
                  onChange={(event) => {
                    onChange({
                      ...filters,
                      yearFrom: event.target.value === '' ? null : Number(event.target.value),
                    });
                  }}
                >
                  <option value="">Any year</option>
                  {years.map((year) => (
                    <option
                      key={year}
                      value={year}
                      disabled={filters.yearTo !== null && year > filters.yearTo}
                    >
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <span className="filter-panel__years-dash" aria-hidden="true">
                –
              </span>
              <label className="select">
                <span className="visually-hidden">To year</span>
                <select
                  value={filters.yearTo ?? ''}
                  onChange={(event) => {
                    onChange({
                      ...filters,
                      yearTo: event.target.value === '' ? null : Number(event.target.value),
                    });
                  }}
                >
                  <option value="">Any year</option>
                  {years.map((year) => (
                    <option
                      key={year}
                      value={year}
                      disabled={filters.yearFrom !== null && year < filters.yearFrom}
                    >
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        )}

        {(['genres', 'artists', 'labels', 'countries', 'formats'] as const).map((key) => (
          <ChipGroup
            key={key}
            title={FACET_TITLES[key]}
            values={facets[key]}
            selected={filters[key]}
            onToggle={(value) => {
              setFacet(key, value);
            }}
            searchable={key === 'artists' || key === 'labels' || key === 'genres'}
            {...(key === 'countries'
              ? {
                  render: (code: string) => {
                    const display = countryDisplay(code);
                    return display ? (
                      <>
                        {display.flag !== null && <span aria-hidden="true">{display.flag} </span>}
                        {display.name}
                      </>
                    ) : (
                      code
                    );
                  },
                }
              : {})}
          />
        ))}
      </div>

      {footer && <footer className="filter-panel__footer">{footer}</footer>}
    </motion.aside>
  );
}
