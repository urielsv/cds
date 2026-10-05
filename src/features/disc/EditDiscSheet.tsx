import { useEffect, useRef, useState } from 'react';

import { AdminSheet } from '@/features/admin/AdminSheet';
import { api, ApiError } from '@/lib/api';
import { prepareImage, type PreparedArtwork } from '@/lib/artwork';
import { evictDisc } from '@/lib/collection';
import { type Disc, type DiscIndexEntry } from '@shared/disc';

interface EditDiscSheetProps {
  /** The index entry (always present) and the full record when it has loaded. */
  entry: DiscIndexEntry;
  detail: Disc | null;
  onClose: () => void;
  onEdited: (entry: DiscIndexEntry) => void;
  onDeleted: (id: string) => void;
  onSessionExpired: () => void;
}

type ArtState =
  | { status: 'unchanged' }
  | { status: 'loading' }
  | { status: 'ready'; artwork: PreparedArtwork }
  | { status: 'failed'; message: string };

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** Comma-separated genres both ways: easy to type, matches how they display. */
function parseGenres(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((g) => g.trim())
        .filter((g) => g.length > 0),
    ),
  ];
}

/**
 * Owner-only editing for one disc: correct its country, format and genres, or
 * replace the cover, or delete it. The fields offered here are exactly those
 * the server records in `manualFields`, so a future MusicBrainz re-sync will
 * not undo a correction made here.
 */
export function EditDiscSheet({
  entry,
  detail,
  onClose,
  onEdited,
  onDeleted,
  onSessionExpired,
}: EditDiscSheetProps) {
  const [country, setCountry] = useState(detail?.country ?? entry.country ?? '');
  const [format, setFormat] = useState(detail?.format ?? entry.format ?? '');
  const [genresText, setGenresText] = useState((detail?.genres ?? entry.genres).join(', '));
  const [art, setArt] = useState<ArtState>({ status: 'unchanged' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  // Country, format and genres are all present on the index entry already
  // (they are filterable, so the shelf carries them), so the fields seed from
  // `entry` and never need the full `detail` record to populate — no effect,
  // no cascading render. `detail` is used only as the source of truth when
  // computing what actually changed on save.

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
      // Downscaled here, in the browser, before anything is uploaded.
      setArt({ status: 'ready', artwork: await prepareImage(file) });
    } catch (err) {
      setArt({ status: 'failed', message: describeError(err) });
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // Only send what changed. An unchanged field is omitted so the server
      // does not needlessly mark it as a manual override.
      const body: Record<string, unknown> = {};
      const nextCountry = country.trim() === '' ? null : country.trim();
      const nextFormat = format.trim() === '' ? null : format.trim();
      const nextGenres = parseGenres(genresText);
      if (nextCountry !== (detail?.country ?? entry.country ?? null)) body.country = nextCountry;
      if (nextFormat !== (detail?.format ?? entry.format ?? null)) body.format = nextFormat;
      const currentGenres = detail?.genres ?? entry.genres;
      if (nextGenres.join('\u0000') !== currentGenres.join('\u0000')) body.genres = nextGenres;
      if (art.status === 'ready') {
        body.artwork = {
          color: art.artwork.color,
          placeholder: art.artwork.placeholder,
          tile: art.artwork.tile,
          large: art.artwork.large,
        };
      }

      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }

      const result = await api<{ entry: DiscIndexEntry; indexUrl: string }>(
        `/api/discs/${encodeURIComponent(entry.id)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      // The stored disc document changed; drop the stale cached copy so the
      // panel refetches fresh detail next time it opens.
      evictDisc(entry.id);
      onEdited(result.entry);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSessionExpired();
      else setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // DELETE still carries a JSON body so the same-origin content-type gate
      // on the server accepts it.
      await api(`/api/discs/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
        body: '{}',
      });
      evictDisc(entry.id);
      onDeleted(entry.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSessionExpired();
      else setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={`Edit · ${entry.title}`} onClose={onClose}>
      <div className="admin-form">
        <div className="edit-cover">
          <img
            className="edit-cover__preview"
            src={previewUrl ?? entry.thumbnail?.url}
            alt={`Cover of ${entry.title}`}
            width={entry.thumbnail?.width ?? 120}
            height={entry.thumbnail?.height ?? 120}
            style={{ backgroundColor: entry.color ?? undefined }}
          />
          <button type="button" className="text-button" onClick={() => photoInput.current?.click()}>
            {art.status === 'ready' ? 'Use a different photo' : 'Replace cover'}
          </button>
          <input
            ref={photoInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void choosePhoto(event.target.files?.[0])}
          />
          {art.status === 'failed' && <p className="admin-form__warning">{art.message}</p>}
        </div>

        <label className="field">
          <span className="field__label">Country</span>
          <input
            className="field__input"
            type="text"
            maxLength={8}
            placeholder="e.g. JP, GB, XW"
            value={country}
            onChange={(event) => {
              setCountry(event.target.value.toUpperCase());
            }}
          />
        </label>

        <label className="field">
          <span className="field__label">Format</span>
          <input
            className="field__input"
            type="text"
            maxLength={60}
            placeholder="e.g. CD, SHM-CD, CD + DVD"
            value={format}
            onChange={(event) => {
              setFormat(event.target.value);
            }}
          />
        </label>

        <label className="field">
          <span className="field__label">Genres</span>
          <input
            className="field__input"
            type="text"
            placeholder="comma, separated, genres"
            value={genresText}
            onChange={(event) => {
              setGenresText(event.target.value);
            }}
          />
        </label>

        {error !== null && (
          <p className="admin-form__error" role="alert">
            {error}
          </p>
        )}

        <div className="review__actions">
          <button type="button" className="pill-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="pill-button pill-button--primary"
            onClick={() => void save()}
            disabled={saving || art.status === 'loading'}
          >
            {saving ? 'Saving…' : art.status === 'loading' ? 'Preparing…' : 'Save changes'}
          </button>
        </div>

        <div className="edit-danger">
          {confirmingDelete ? (
            <div className="admin-form__confirm" role="alert">
              <p>
                Delete <strong>{entry.title}</strong> permanently? This removes it from the
                collection.
              </p>
              <div className="review__actions">
                <button
                  type="button"
                  className="pill-button"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                  disabled={saving}
                >
                  Keep it
                </button>
                <button
                  type="button"
                  className="pill-button pill-button--danger"
                  onClick={() => void remove()}
                  disabled={saving}
                >
                  {saving ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              Delete this album…
            </button>
          )}
        </div>
      </div>
    </AdminSheet>
  );
}
