import { mbidSchema } from '../../shared/disc.js';
import { normaliseBarcode } from '../../shared/format.js';
import { type CandidateSummary, toCandidate } from '../../shared/musicbrainz.js';

import { isOwner } from './auth.js';
import { json, methodNotAllowed, problem } from './http.js';
import {
  type MusicBrainzClient,
  MusicBrainzNotFoundError,
  MusicBrainzUnavailableError,
} from './musicbrainz.js';

export type LookupMode = 'auto' | 'barcode';

/**
 * Resolves whatever the owner typed into ranked candidates: a barcode (typed
 * or scanned), a pasted MusicBrainz release id, or free text.
 */
export async function lookupCandidates(
  input: string,
  mode: LookupMode,
  musicbrainz: MusicBrainzClient,
): Promise<{ kind: 'barcode' | 'release' | 'text'; candidates: CandidateSummary[] }> {
  const trimmed = input.trim();

  const barcode = normaliseBarcode(trimmed);
  if (mode === 'barcode' || (barcode !== null && /^[\d\s-]+$/.test(trimmed))) {
    return {
      kind: 'barcode',
      candidates: barcode === null ? [] : await musicbrainz.searchBarcode(barcode),
    };
  }

  const mbid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(trimmed)?.[0];
  if (mbid !== undefined && mbidSchema.safeParse(mbid.toLowerCase()).success) {
    try {
      const release = await musicbrainz.lookupRelease(mbid.toLowerCase());
      return {
        kind: 'release',
        candidates: [
          {
            ...toCandidate(release),
            searchScore: 100,
            hasCoverArt: release['cover-art-archive']?.front === true,
          },
        ],
      };
    } catch (error) {
      if (error instanceof MusicBrainzNotFoundError) return { kind: 'release', candidates: [] };
      throw error;
    }
  }

  return { kind: 'text', candidates: await musicbrainz.searchReleases(trimmed) };
}

/**
 * Shared GET handler for the lookup routes. Authenticated: these are only used
 * by the add flow, and an open route would make this deployment a public,
 * unthrottled MusicBrainz proxy — and get the shared IP blocked.
 */
export async function handleLookup(
  request: Request,
  mode: LookupMode,
  deps: { secret: string | undefined; musicbrainz: () => MusicBrainzClient },
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  if (!(await isOwner(request, deps.secret))) {
    return problem(401, 'signed_out', 'Sign in as the owner to look up releases.');
  }

  const q = new URL(request.url).searchParams.get('q') ?? '';
  if (q.trim().length < 2 || q.length > 200) {
    return problem(400, 'invalid_query', 'Type at least two characters.');
  }

  try {
    const result = await lookupCandidates(q, mode, deps.musicbrainz());
    return json(result);
  } catch (error) {
    if (error instanceof MusicBrainzUnavailableError) {
      // "Unavailable" is distinct from "no results": the right next step is to
      // wait (or enter details by hand), not to retype.
      return problem(503, 'musicbrainz_unavailable', error.message, {
        retryAfter: error.retryAfterSeconds,
      });
    }
    throw error;
  }
}
