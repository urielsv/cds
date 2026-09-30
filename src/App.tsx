import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { AddAlbumSheet } from '@/features/admin/AddAlbumSheet';
import { SignInDialog } from '@/features/admin/SignInDialog';
import { useAdminSession } from '@/features/admin/useAdminSession';
import { DiscPanel } from '@/features/disc/DiscPanel';
import { ArrangeMenu } from '@/features/search/ArrangeMenu';
import { FilterPanel } from '@/features/search/FilterPanel';
import { FloatingBar } from '@/features/search/FloatingBar';
import { Shelf, type ShelfHandle } from '@/features/shelf/Shelf';
import { useDebouncedValue, useQueryState } from '@/hooks/useQueryState';
import { api } from '@/lib/api';
import { loadCollection } from '@/lib/collection';
import { createDiscSearch } from '@/lib/search';
import {
  activeFilterCount,
  deriveFacets,
  EMPTY_FILTERS,
  matchesFilters,
  sortDiscs,
} from '@shared/collection';
import { type DiscIndexEntry } from '@shared/disc';

/**
 * Typing re-filters after this pause rather than on every key, so the wall is
 * never re-dimmed mid-word or during a pan (requirement 8.4).
 */
const SEARCH_DEBOUNCE_MS = 140;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; discs: DiscIndexEntry[]; isDemo: boolean };

type Overlay = 'none' | 'filters' | 'arrange' | 'sign-in' | 'add';

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [queryState, updateQuery] = useQueryState();
  const [overlay, setOverlay] = useState<Overlay>(() =>
    typeof window !== 'undefined' && window.location.hash === '#admin' ? 'sign-in' : 'none',
  );
  const [openDisc, setOpenDisc] = useState<DiscIndexEntry | null>(null);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const shelfRef = useRef<ShelfHandle>(null);
  const session = useAdminSession();

  useEffect(() => {
    const controller = new AbortController();
    loadCollection(controller.signal)
      .then(({ index, isDemo }) => {
        setLoad({ status: 'ready', discs: index.discs, isDemo });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          status: 'error',
          message: error instanceof Error ? error.message : 'The collection could not be loaded.',
        });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const discs = useMemo(() => (load.status === 'ready' ? load.discs : []), [load]);

  // ---- Search, filter, sort: all in memory, all memoised ---------------------

  const search = useMemo(() => createDiscSearch(discs), [discs]);
  const facets = useMemo(() => deriveFacets(discs), [discs]);
  const query = useDebouncedValue(queryState.query, SEARCH_DEBOUNCE_MS);
  const { filters, sort, groupMatches, wallMode } = queryState;
  const filterCount = activeFilterCount(filters);

  /** Null when nothing is narrowing, so the wall shows every cover at full strength. */
  const matches = useMemo<ReadonlySet<string> | null>(() => {
    const textMatches = search.match(query);
    if (textMatches === null && filterCount === 0) return null;
    const ids = new Set<string>();
    for (const disc of discs) {
      if (textMatches !== null && !textMatches.has(disc.id)) continue;
      if (filterCount > 0 && !matchesFilters(disc, filters)) continue;
      ids.add(disc.id);
    }
    return ids;
  }, [discs, search, query, filters, filterCount]);

  const ordered = useMemo(() => {
    const sorted = sortDiscs(discs, sort);
    if (!groupMatches || matches === null) return sorted;
    return [
      ...sorted.filter((disc) => matches.has(disc.id)),
      ...sorted.filter((disc) => !matches.has(disc.id)),
    ];
  }, [discs, sort, groupMatches, matches]);

  // ---- Opening a disc ----------------------------------------------------------

  const handleOpen = useCallback((disc: DiscIndexEntry) => {
    setOverlay('none');
    setOpenDisc(disc);
  }, []);

  const originRect = useCallback(
    () => (openDisc ? (shelfRef.current?.rectFor(openDisc.id) ?? null) : null),
    [openDisc],
  );

  const handleClosed = useCallback(() => {
    const id = openDisc?.id;
    setOpenDisc(null);
    // Focus returns to the cover that was opened (requirement 7.4).
    if (id !== undefined) shelfRef.current?.focusDisc(id);
  }, [openDisc]);

  // ---- Owner actions -------------------------------------------------------------

  const closeOverlay = useCallback(() => {
    setOverlay('none');
  }, []);

  const handleAdded = useCallback((entry: DiscIndexEntry) => {
    setLoad((previous) =>
      previous.status === 'ready'
        ? {
            ...previous,
            // A real add replaces the demo wall rather than mixing into it.
            discs: previous.isDemo
              ? [entry]
              : [entry, ...previous.discs.filter((d) => d.id !== entry.id)],
            isDemo: false,
          }
        : { status: 'ready', discs: [entry], isDemo: false },
    );
    setOverlay('none');
    setArrivedId(entry.id);
  }, []);

  // Once the new disc is in the tree, fly the camera to it so it can be seen
  // settling into the wall (requirement 4.12).
  useEffect(() => {
    if (arrivedId === null) return;
    const frame = requestAnimationFrame(() => {
      void shelfRef.current?.reveal(arrivedId);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [arrivedId]);

  /**
   * Rating a disc changes how large it is drawn, so the in-memory collection is
   * updated as soon as the server confirms and the wall re-packs around it.
   */
  const handleRate = useCallback(
    async (rating: number | null) => {
      const id = openDisc?.id;
      if (id === undefined) return;
      const { entry } = await api<{ entry: DiscIndexEntry }>(
        `/api/discs/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify({ rating }) },
      );
      setLoad((previous) =>
        previous.status === 'ready'
          ? {
              ...previous,
              discs: previous.discs.map((disc) => (disc.id === entry.id ? entry : disc)),
            }
          : previous,
      );
      setOpenDisc((previous) => (previous?.id === entry.id ? entry : previous));
    },
    [openDisc],
  );

  const clearNarrowing = useCallback(() => {
    updateQuery({ query: '', filters: EMPTY_FILTERS });
  }, [updateQuery]);

  const toggle = (target: Overlay) => {
    setOverlay((current) => (current === target ? 'none' : target));
  };

  const ownerFooter =
    session.status === 'signed-in' ? (
      <div className="owner-row">
        <span className="owner-row__label">Signed in as owner</span>
        <button type="button" className="text-button" onClick={() => void session.signOut()}>
          Sign out
        </button>
      </div>
    ) : (
      <button
        type="button"
        className="text-button owner-row__sign-in"
        onClick={() => {
          setOverlay('sign-in');
        }}
      >
        <Icon name="lock" size={14} /> Owner sign in
      </button>
    );

  return (
    <>
      <h1 className="visually-hidden">MyCDs</h1>

      <main className="app-main">
        {load.status === 'loading' && (
          <p className="app-message" role="status">
            Loading the collection…
          </p>
        )}

        {load.status === 'error' && (
          <div className="app-message" role="alert">
            <p>{load.message}</p>
            <button
              type="button"
              className="pill-button"
              onClick={() => {
                setLoad({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {load.status === 'ready' && discs.length === 0 && (
          <div className="app-message">
            <p>No albums yet.</p>
            {session.status === 'signed-in' ? (
              <button
                type="button"
                className="pill-button"
                onClick={() => {
                  setOverlay('add');
                }}
              >
                Add the first one
              </button>
            ) : null}
          </div>
        )}

        {load.status === 'ready' && discs.length > 0 && (
          <Shelf
            ref={shelfRef}
            discs={ordered}
            matches={matches}
            wallMode={wallMode}
            openDiscId={openDisc?.id ?? null}
            arrivedDiscId={arrivedId}
            onOpen={handleOpen}
          />
        )}
      </main>

      {load.status === 'ready' && load.isDemo && <p className="demo-note">Demo collection</p>}

      <FloatingBar
        query={queryState.query}
        onQueryChange={(value) => {
          updateQuery({ query: value });
        }}
        totalCount={discs.length}
        matchCount={matches === null ? null : matches.size}
        onClear={clearNarrowing}
        activeFilters={filterCount}
        filtersOpen={overlay === 'filters'}
        onToggleFilters={() => {
          toggle('filters');
        }}
        arrangeOpen={overlay === 'arrange'}
        onToggleArrange={() => {
          toggle('arrange');
        }}
        onZoomIn={() => shelfRef.current?.zoomStep(1)}
        onZoomOut={() => shelfRef.current?.zoomStep(-1)}
        onShowAll={() => shelfRef.current?.showAll()}
        trailing={
          session.status === 'signed-in' ? (
            <button
              type="button"
              className="floating-bar__button floating-bar__button--accent"
              onClick={() => {
                toggle('add');
              }}
            >
              <Icon name="plus" />
              <span className="visually-hidden">Add an album</span>
            </button>
          ) : undefined
        }
      />

      <AnimatePresence>
        {overlay === 'filters' && (
          <FilterPanel
            key="filters"
            facets={facets}
            filters={filters}
            onChange={(next) => {
              updateQuery({ filters: next });
            }}
            matchCount={matches === null ? discs.length : matches.size}
            totalCount={discs.length}
            onClose={closeOverlay}
            footer={ownerFooter}
          />
        )}
        {overlay === 'arrange' && (
          <ArrangeMenu
            key="arrange"
            wallMode={wallMode}
            onWallModeChange={(mode) => {
              updateQuery({ wallMode: mode });
            }}
            sort={sort}
            onSortChange={(next) => {
              updateQuery({ sort: next });
            }}
            groupMatches={groupMatches}
            onGroupMatchesChange={(value) => {
              updateQuery({ groupMatches: value });
            }}
            onClose={closeOverlay}
          />
        )}
        {overlay === 'sign-in' && (
          <SignInDialog
            key="sign-in"
            session={session}
            onClose={closeOverlay}
            onSignedIn={() => {
              setOverlay('add');
            }}
          />
        )}
        {overlay === 'add' && session.status === 'signed-in' && (
          <AddAlbumSheet
            key="add"
            existing={discs}
            onClose={closeOverlay}
            onAdded={handleAdded}
            onSessionExpired={() => {
              void session.refresh();
              setOverlay('sign-in');
            }}
          />
        )}
      </AnimatePresence>

      {openDisc && (
        <DiscPanel
          key={openDisc.id}
          disc={openDisc}
          originRect={originRect}
          onClosed={handleClosed}
          onRate={session.status === 'signed-in' ? handleRate : undefined}
        />
      )}
    </>
  );
}
