import { useCallback, useEffect, useState } from 'react';

import { parseQueryState, type QueryState, serialiseQueryState } from '@shared/collection';

function readFromUrl(): QueryState {
  return parseQueryState(typeof window === 'undefined' ? '' : window.location.search);
}

/**
 * Search, filter and sort state, mirrored into the URL (requirement 3.7) so a
 * filtered view can be shared as a link.
 *
 * `replaceState` rather than `pushState`: every keystroke would otherwise become
 * a history entry and the back button would replay typing.
 */
export function useQueryState() {
  const [state, setState] = useState<QueryState>(readFromUrl);

  useEffect(() => {
    const search = serialiseQueryState(state);
    const url = `${window.location.pathname}${search.length > 0 ? `?${search}` : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [state]);

  const update = useCallback((patch: Partial<QueryState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  return [state, update] as const;
}

/** Trails a fast-changing value, so typing does not re-filter on every key. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}
