import { type SubmitEvent, useCallback, useEffect, useRef, useState } from 'react';

import { CountryBadge } from '@/components/CountryBadge';
import { Icon } from '@/components/Icon';
import { api, ApiError } from '@/lib/api';
import {
  candidateThumbnailUrl,
  NoArtworkError,
  type PreparedArtwork,
  prepareCoverArt,
  prepareImage,
} from '@/lib/artwork';
import { type DiscIndexEntry } from '@shared/disc';
import { releaseYear } from '@shared/format';
import { type CandidateSummary, hasCdMedium } from '@shared/musicbrainz';

import { AdminSheet } from './AdminSheet';

interface AddAlbumSheetProps {
  existing: readonly DiscIndexEntry[];
  onClose: () => void;
  onAdded: (entry: DiscIndexEntry) => void;
  onSessionExpired: () => void;
}

/**
 * MusicBrainz allows about one request a second, shared by everyone on the
 * same serverless IP, so the search waits for a pause in typing rather than
 * firing per keystroke.
 */
const SEARCH_PAUSE_MS = 700;

type ArtState =
  | { status: 'loading' }
  | { status: 'ready'; artwork: PreparedArtwork; source: 'archive' | 'photo' }
  | { status: 'none' }
  | { status: 'failed'; message: string };

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; candidates: CandidateSummary[]; kind: string }
  | { status: 'error'; message: string };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'musicbrainz_unavailable') {
      return 'MusicBrainz is busy or unavailable right now. Wait a moment and try again.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function CandidateMeta({ candidate }: { candidate: CandidateSummary }) {
  const year = releaseYear(candidate.date);
  const parts = [
    year === null ? null : String(year),
    candidate.formats.join(' + ') || null,
    candidate.labels[0] ?? null,
    candidate.catalogNumber,
    candidate.trackCount === null ? null : `${String(candidate.trackCount)} tracks`,
  ].filter((part): part is string => part !== null && part.length > 0);

  return (
    <span className="candidate__meta">
      <CountryBadge country={candidate.country} />
      <span>{parts.join(' · ')}</span>
    </span>
  );
}

/**
 * Adding an album: search (by name, barcode or pasted MusicBrainz id), pick
 * the exact pressing from ranked candidates, check the artwork, save.
 *
 * The owner always chooses — even when there is a single result — because a
 * barcode identifies a product line, not a pressing, and a silent pick is how
 * a collection fills up with the wrong editions.
 */
export function AddAlbumSheet({
  existing,
  onClose,
  onAdded,
  onSessionExpired,
}: AddAlbumSheetProps) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [selected, setSelected] = useState<CandidateSummary | null>(null);
  const [art, setArt] = useState<ArtState>({ status: 'loading' });
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [setupUrl, setSetupUrl] = useState<{ url: string; entry: DiscIndexEntry } | null>(null);
  const lastQuery = useRef('');
  const photoInput = useRef<HTMLInputElement>(null);

  // ---- Searching ------------------------------------------------------------

  const runSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < 2 || trimmed === lastQuery.current) return;
      lastQuery.current = trimmed;
      setSearch({ status: 'searching' });
      try {
        const result = await api<{ kind: string; candidates: CandidateSummary[] }>(
          `/api/lookup/search?q=${encodeURIComponent(trimmed)}`,
        );
        // A slower earlier search must not overwrite a newer one.
        if (lastQuery.current === trimmed) setSearch({ status: 'done', ...result });
      } catch (error) {
        lastQuery.current = '';
        if (error instanceof ApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        setSearch({ status: 'error', message: describeError(error) });
      }
    },
    [onSessionExpired],
  );

  const pauseTimer = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(pauseTimer.current);
    },
    [],
  );
  const handleTyping = (value: string) => {
    setText(value);
    window.clearTimeout(pauseTimer.current);
    if (value.trim().length >= 3) {
      pauseTimer.current = window.setTimeout(() => void runSearch(value), SEARCH_PAUSE_MS);
    }
  };

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault();
    window.clearTimeout(pauseTimer.current);
    lastQuery.current = '';
    void runSearch(text);
  };

  // ---- Artwork ----------------------------------------------------------------

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    prepareCoverArt(selected.mbid, controller.signal)
      .then((artwork) => {
        setArt({ status: 'ready', artwork, source: 'archive' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // No art is normal and still produces a valid disc.
        setArt(
          error instanceof NoArtworkError
            ? { status: 'none' }
            : { status: 'failed', message: describeError(error) },
        );
      });
    return () => {
      controller.abort();
    };
  }, [selected]);

  // Object URLs hold the image in memory until revoked.
  const previewUrl = art.status === 'ready' ? art.artwork.previewUrl : null;
  useEffect(
    () => () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    setArt({ status: 'loading' });
    try {
      // Downscaled here, on the phone, before anything is uploaded.
      setArt({ status: 'ready', artwork: await prepareImage(file), source: 'photo' });
    } catch (error) {
      setArt({ status: 'failed', message: describeError(error) });
    }
  };

  // ---- Saving -------------------------------------------------------------------

  const save = async (allowDuplicate: boolean) => {
    if (!selected || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const artwork =
        art.status === 'ready'
          ? {
              color: art.artwork.color,
              placeholder: art.artwork.placeholder,
              tile: art.artwork.tile,
              large: art.artwork.large,
            }
          : null;
      const result = await api<{ entry: DiscIndexEntry; indexUrl: string }>('/api/discs', {
        method: 'POST',
        body: JSON.stringify({
          mbid: selected.mbid,
          notes: notes.trim().length > 0 ? notes.trim() : null,
          allowDuplicate,
          artwork,
        }),
      });
      setDuplicate(null);
      const configured = import.meta.env.VITE_COLLECTION_INDEX_URL;
      if (configured === undefined || configured.length === 0) {
        // First run: the site does not know where the collection lives yet.
        setSetupUrl({ url: result.indexUrl, entry: result.entry });
      } else {
        onAdded(result.entry);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
      } else if (error instanceof ApiError && error.code === 'duplicate') {
        setDuplicate(error.message);
      } else {
        setSaveError(describeError(error));
      }
    } finally {
      setSaving(false);
    }
  };

  // ---- Render -----------------------------------------------------------------

  if (setupUrl) {
    return (
      <AdminSheet
        title="Saved — one last step"
        onClose={() => {
          onAdded(setupUrl.entry);
        }}
      >
        <div className="admin-form">
          <p className="admin-form__hint">
            Your first album is stored. So that visitors see the real collection instead of the
            demo, set this environment variable in the Vercel project and redeploy:
          </p>
          <code className="admin-code">VITE_COLLECTION_INDEX_URL={setupUrl.url}</code>
          <button
            type="button"
            className="pill-button pill-button--primary"
            onClick={() => {
              onAdded(setupUrl.entry);
            }}
          >
            Done
          </button>
        </div>
      </AdminSheet>
    );
  }

  if (selected) {
    const alreadyOwned = existing.some((disc) => disc.releaseMbid === selected.mbid);
    return (
      <AdminSheet title="Add this pressing?" onClose={onClose} wide>
        <div className="review">
          <div className="review__art">
            {art.status === 'loading' && (
              <div
                className="review__cover review__cover--loading"
                aria-label="Preparing artwork"
                role="img"
              />
            )}
            {art.status === 'ready' && (
              <img
                className="review__cover"
                src={art.artwork.previewUrl}
                alt={`Cover of ${selected.title}`}
              />
            )}
            {(art.status === 'none' || art.status === 'failed') && (
              <div className="review__cover review__cover--empty">
                <span>{art.status === 'none' ? 'No cover art' : 'Artwork unavailable'}</span>
              </div>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => photoInput.current?.click()}
            >
              {art.status === 'ready' && art.source === 'photo'
                ? 'Use a different photo'
                : 'Use my own photo'}
            </button>
            <input
              ref={photoInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void choosePhoto(event.target.files?.[0])}
            />
          </div>

          <div className="review__details">
            <h3 className="review__title">{selected.title}</h3>
            <p className="review__artist">{selected.artist}</p>
            <CandidateMeta candidate={selected} />
            {selected.barcode !== null && (
              <p className="review__barcode">Barcode {selected.barcode}</p>
            )}
            {!hasCdMedium(selected) && (
              <p className="admin-form__warning">
                MusicBrainz lists this release as{' '}
                {selected.formats.join(' + ') || 'an unknown format'}, not a CD.
              </p>
            )}
            {alreadyOwned && duplicate === null && (
              <p className="admin-form__warning">
                This exact pressing is already in the collection.
              </p>
            )}
            {art.status === 'failed' && <p className="admin-form__warning">{art.message}</p>}

            <label className="field">
              <span className="field__label">Notes (optional)</span>
              <textarea
                className="field__input field__input--area"
                rows={3}
                maxLength={4000}
                placeholder="Where you got it, condition, signed…"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
              />
            </label>

            {saveError !== null && (
              <p className="admin-form__error" role="alert">
                {saveError}
              </p>
            )}
            {duplicate !== null && (
              <div className="admin-form__confirm" role="alert">
                <p>{duplicate} Add another copy?</p>
                <button
                  type="button"
                  className="pill-button"
                  onClick={() => void save(true)}
                  disabled={saving}
                >
                  Add anyway
                </button>
              </div>
            )}

            <div className="review__actions">
              <button
                type="button"
                className="pill-button"
                onClick={() => {
                  setSelected(null);
                  setDuplicate(null);
                  setSaveError(null);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="pill-button pill-button--primary"
                disabled={saving || art.status === 'loading'}
                onClick={() => void save(false)}
              >
                {saving
                  ? 'Saving…'
                  : art.status === 'loading'
                    ? 'Preparing artwork…'
                    : 'Add to collection'}
              </button>
            </div>
          </div>
        </div>
      </AdminSheet>
    );
  }

  return (
    <AdminSheet title="Add an album" onClose={onClose} wide>
      <form className="add-search" onSubmit={submitSearch} role="search">
        <label className="add-search__field">
          <Icon name="search" size={18} />
          <span className="visually-hidden">Artist and album, barcode, or MusicBrainz link</span>
          <input
            className="add-search__input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Artist and album, or the barcode"
            value={text}
            onChange={(event) => {
              handleTyping(event.target.value);
            }}
          />
        </label>
        <button type="submit" className="pill-button pill-button--primary">
          Search
        </button>
      </form>

      <div className="add-results" aria-live="polite" aria-busy={search.status === 'searching'}>
        {search.status === 'idle' && (
          <p className="admin-form__hint">
            Type an artist and title (&ldquo;cerati bocanada&rdquo;), the digits under the barcode,
            or paste a MusicBrainz release link. You&rsquo;ll pick the exact pressing next.
          </p>
        )}
        {search.status === 'searching' && (
          <p className="admin-form__hint">Searching MusicBrainz…</p>
        )}
        {search.status === 'error' && (
          <p className="admin-form__error" role="alert">
            {search.message}
          </p>
        )}
        {search.status === 'done' && search.candidates.length === 0 && (
          <p className="admin-form__hint">
            {search.kind === 'barcode'
              ? 'MusicBrainz does not know that barcode. Try the artist and title instead.'
              : 'Nothing found. Try fewer words, or check the spelling.'}
          </p>
        )}
        {search.status === 'done' && search.candidates.length > 0 && (
          <ul className="candidates" aria-label="Matching releases">
            {search.candidates.map((candidate) => (
              <li key={candidate.mbid}>
                <button
                  type="button"
                  className="candidate"
                  onClick={() => {
                    setArt({ status: 'loading' });
                    setSelected(candidate);
                  }}
                >
                  <span className="candidate__thumb">
                    <img
                      src={candidateThumbnailUrl(candidate.mbid)}
                      alt=""
                      width={250}
                      height={250}
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden';
                      }}
                    />
                  </span>
                  <span className="candidate__text">
                    <span className="candidate__title">{candidate.title}</span>
                    <span className="candidate__artist">{candidate.artist}</span>
                    <CandidateMeta candidate={candidate} />
                  </span>
                  {existing.some((disc) => disc.releaseMbid === candidate.mbid) && (
                    <span className="candidate__owned">Owned</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminSheet>
  );
}
