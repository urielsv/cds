import { type ReactNode, useEffect, useRef } from 'react';

import { Icon } from '@/components/Icon';

interface FloatingBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  totalCount: number;
  /** Discs matching search and filters; null when nothing is narrowing. */
  matchCount: number | null;
  /** Clears search and filters in one tap (requirement 3.8). */
  onClear: () => void;
  activeFilters: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  arrangeOpen: boolean;
  onToggleArrange: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onShowAll: () => void;
  /** Owner-only actions, rendered at the end of the bar when signed in. */
  trailing?: ReactNode;
}

/**
 * The one piece of chrome over the wall: a floating pane of glass at the
 * bottom of the screen, within thumb reach, with the covers visible through it.
 */
export function FloatingBar({
  query,
  onQueryChange,
  totalCount,
  matchCount,
  onClear,
  activeFilters,
  filtersOpen,
  onToggleFilters,
  arrangeOpen,
  onToggleArrange,
  onZoomIn,
  onZoomOut,
  onShowAll,
  trailing,
}: FloatingBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" jumps to search from anywhere, as on most sites with a search box.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="floating-bar">
      <div
        className={`floating-bar__status${matchCount === null ? '' : ' floating-bar__status--visible'}`}
      >
        {/* Announced politely so a screen reader user hears what a search did —
            the greying-out alone would be invisible to them. */}
        <p className="floating-bar__status-text" role="status" aria-live="polite">
          {matchCount === null
            ? ''
            : matchCount === 0
              ? 'No matches'
              : `${String(matchCount)} of ${String(totalCount)}`}
        </p>
        {matchCount !== null && (
          <button type="button" className="floating-bar__status-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <nav className="floating-bar__pane glass" aria-label="Browse">
        <div className="floating-bar__search" role="search">
          <label className="floating-bar__field">
            <Icon name="search" size={18} />
            <span className="visually-hidden">Search albums, artists, tracks</span>
            <input
              ref={inputRef}
              className="floating-bar__input"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={`Search ${String(totalCount)} album${totalCount === 1 ? '' : 's'}`}
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query.length > 0) {
                  event.stopPropagation();
                  onQueryChange('');
                }
              }}
            />
          </label>
          {query.length > 0 && (
            <button
              type="button"
              className="floating-bar__clear"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
            >
              <Icon name="close" size={14} />
              <span className="visually-hidden">Clear search</span>
            </button>
          )}
        </div>

        <div className="floating-bar__actions">
          <button
            type="button"
            className="floating-bar__button"
            aria-expanded={filtersOpen}
            aria-controls="filter-panel"
            onClick={onToggleFilters}
          >
            <Icon name="filter" />
            <span className="visually-hidden">
              Filters{activeFilters > 0 ? `, ${String(activeFilters)} active` : ''}
            </span>
            {activeFilters > 0 && (
              <span className="floating-bar__badge" aria-hidden="true">
                {activeFilters}
              </span>
            )}
          </button>

          <button
            type="button"
            className="floating-bar__button"
            aria-expanded={arrangeOpen}
            aria-controls="arrange-menu"
            onClick={onToggleArrange}
          >
            <Icon name="arrange" />
            <span className="visually-hidden">Arrange</span>
          </button>

          {/* Pinch does this on touch screens; these are for mouse and keyboard. */}
          <span className="floating-bar__zoom">
            <button type="button" className="floating-bar__button" onClick={onZoomOut}>
              <Icon name="minus" />
              <span className="visually-hidden">Zoom out</span>
            </button>
            <button type="button" className="floating-bar__button" onClick={onShowAll}>
              <Icon name="fit" />
              <span className="visually-hidden">Show whole collection</span>
            </button>
            <button type="button" className="floating-bar__button" onClick={onZoomIn}>
              <Icon name="plus" />
              <span className="visually-hidden">Zoom in</span>
            </button>
          </span>

          {trailing}
        </div>
      </nav>
    </div>
  );
}
