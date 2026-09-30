import { isOwner } from '../_lib/auth.js';
import { getMusicBrainz, getStore, sessionSecret } from '../_lib/env.js';
import { isSameOriginWrite, json, methodNotAllowed, problem, readJson } from '../_lib/http.js';
import { ingestDisc, ingestRequestSchema, InvalidArtworkError } from '../_lib/ingest.js';
import {
  type MusicBrainzClient,
  MusicBrainzNotFoundError,
  MusicBrainzUnavailableError,
} from '../_lib/musicbrainz.js';
import { type CollectionStore } from '../_lib/store.js';

export async function handleCreateDisc(
  request: Request,
  deps: {
    secret: string | undefined;
    store: () => CollectionStore;
    musicbrainz: () => MusicBrainzClient;
  },
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!isSameOriginWrite(request)) return problem(403, 'forbidden', 'Cross-site request refused.');
  // Verified server-side on every write, whatever the client shows.
  if (!(await isOwner(request, deps.secret))) {
    return problem(401, 'signed_out', 'Your session has expired. Sign in again.');
  }

  const body = await readJson(request, ingestRequestSchema);
  if (!body.ok) return body.response;

  try {
    const result = await ingestDisc(body.data, {
      store: deps.store(),
      musicbrainz: deps.musicbrainz(),
    });
    if (result.kind === 'duplicate') {
      // Warn, do not block: owning two copies is legitimate. The client asks,
      // then resubmits with `allowDuplicate`.
      return problem(409, 'duplicate', `Already in the collection: ${result.existingTitle}.`, {
        existingId: result.existingId,
        reason: result.reason,
      });
    }
    return json({ entry: result.entry, indexUrl: result.indexUrl }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidArtworkError) return problem(400, 'invalid_artwork', error.message);
    if (error instanceof MusicBrainzNotFoundError) {
      return problem(404, 'release_not_found', 'MusicBrainz has no release with that id.');
    }
    if (error instanceof MusicBrainzUnavailableError) {
      return problem(503, 'musicbrainz_unavailable', error.message, {
        retryAfter: error.retryAfterSeconds,
      });
    }
    console.error('Ingest failed', error);
    return problem(500, 'save_failed', 'The disc could not be saved. Nothing was changed.');
  }
}

/** `POST /api/discs` — add a disc to the collection. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleCreateDisc(request, {
      secret: sessionSecret(),
      store: getStore,
      musicbrainz: getMusicBrainz,
    });
  },
};
