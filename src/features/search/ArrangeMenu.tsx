import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

import { Icon } from '@/components/Icon';
import { REDUCED_TRANSITION, transition } from '@/motion/tokens';
import { type Sort, type SortKey, type WallModeName } from '@shared/collection';

const OPTIONS: {
  key: SortKey;
  label: string;
  /** Natural first direction. */ direction: Sort['direction'];
}[] = [
  { key: 'added', label: 'Recently added', direction: 'desc' },
  { key: 'rating', label: 'Rating', direction: 'desc' },
  { key: 'colour', label: 'Colour', direction: 'asc' },
  { key: 'artist', label: 'Artist', direction: 'asc' },
  { key: 'title', label: 'Title', direction: 'asc' },
  { key: 'year', label: 'Release year', direction: 'desc' },
  { key: 'genre', label: 'Genre', direction: 'asc' },
  { key: 'label', label: 'Label', direction: 'asc' },
  { key: 'country', label: 'Country', direction: 'asc' },
];

interface ArrangeMenuProps {
  wallMode: WallModeName;
  onWallModeChange: (mode: WallModeName) => void;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  groupMatches: boolean;
  onGroupMatchesChange: (value: boolean) => void;
  onClose: () => void;
}

/**
 * How the wall is laid out. Choosing the active option again flips its
 * direction, which saves a separate control for the common case.
 */
export function ArrangeMenu({
  wallMode,
  onWallModeChange,
  sort,
  onSortChange,
  groupMatches,
  onGroupMatchesChange,
  onClose,
}: ArrangeMenuProps) {
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={rootRef}
      id="arrange-menu"
      className="popover glass"
      role="dialog"
      aria-label="Arrange"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      transition={reduced ? REDUCED_TRANSITION : transition('base', 'entrance')}
    >
      <p className="popover__heading" id="size-heading">
        Cover size
      </p>
      <div className="popover__segmented" role="radiogroup" aria-labelledby="size-heading">
        {(
          [
            { mode: 'even', label: 'Even', hint: 'Every cover the same size' },
            { mode: 'rating', label: 'By rating', hint: 'Your favourites drawn larger' },
          ] as const
        ).map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={wallMode === option.mode}
            className={`popover__segment${wallMode === option.mode ? ' popover__segment--active' : ''}`}
            onClick={() => {
              onWallModeChange(option.mode);
            }}
          >
            {option.label}
            <small>{option.hint}</small>
          </button>
        ))}
      </div>

      <p className="popover__heading" id="arrange-heading">
        Arrange by
      </p>
      <div className="popover__options" role="radiogroup" aria-labelledby="arrange-heading">
        {OPTIONS.map((option) => {
          const active = sort.key === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={active}
              className={`popover__option${active ? ' popover__option--active' : ''}`}
              onClick={() => {
                onSortChange(
                  active
                    ? { key: option.key, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
                    : { key: option.key, direction: option.direction },
                );
              }}
            >
              <span>{option.label}</span>
              {active && (
                <span className="popover__direction">
                  <Icon name={sort.direction === 'asc' ? 'asc' : 'desc'} size={16} />
                  <span className="visually-hidden">
                    {sort.direction === 'asc' ? 'ascending' : 'descending'}, press to reverse
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <label className="popover__toggle">
        <input
          type="checkbox"
          className="switch"
          checked={groupMatches}
          onChange={(event) => {
            onGroupMatchesChange(event.target.checked);
          }}
        />
        <span>
          Gather matches first
          <small>Search results move to the start instead of staying in place</small>
        </span>
      </label>
    </motion.div>
  );
}
