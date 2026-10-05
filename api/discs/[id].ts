import { isOwner } from '../_lib/auth.js';
import { deleteDisc, DiscNotFoundError, editDisc, editRequestSchema } from '../_lib/discEdit.js';
import { getStore, sessionSecret } from '../_lib/env.js';
import { isSameOriginWrite, json, methodNotAllowed, problem, readJson } from '../_lib/http.js';
import { InvalidArtworkError } from '../_lib/ingest.js';
import { type CollectionStore } from '../_lib/store.js';

/** `[a-z0-9-]` only — the same slug shape disc ids are minted in. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Pulls the `<id>` out of `/api/discs/<id>` without needing a router. */
function discId(request: Request): string | null {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const last = path.slice(path.lastIndexOf('/') + 1);
  const id = decodeURIComponent(last);
  return ID_PATTERN.test(id) ? id : null;
}

export async function handleDiscMutation(
  request: Request,
  deps: { secret: string | undefined; store: () => CollectionStore },
): Promise<Response> {
  if (request.method !== 'DELETE' && request.method !== 'PATCH') {
    return methodNotAllowed(['DELETE', 'PATCH']);
  }
  // isSameOriginWrite requires a JSON content-type on non-GET writes, so both
  // the DELETE and the PATCH must carry a JSON body (the client sends one).
  if (!isSameOriginWrite(request)) return problem(403, 'forbidden', 'Cross-site request refused.');
  // Verified server-side on every mutation, whatever the client shows.
  if (!(await isOwner(request, deps.secret))) {
    return problem(401, 'signed_out', 'Your session has expired. Sign in again.');
  }

  const id = discId(request);
  if (id === null) return problem(400, 'invalid_id', 'That is not a valid disc id.');

  try {
    if (request.method === 'DELETE') {
      const result = await deleteDisc(id, { store: deps.store() });
      return json({ deleted: id, indexUrl: result.indexUrl });
    }

    const body = await readJson(request, editRequestSchema);
    if (!body.ok) return body.response;
    const result = await editDisc(id, body.data, { store: deps.store() });
    return json({ entry: result.entry, indexUrl: result.indexUrl });
  } catch (error) {
    if (error instanceof DiscNotFoundError) {
      return problem(404, 'not_found', 'That disc is not in the collection.');
    }
    if (error instanceof InvalidArtworkError) return problem(400, 'invalid_artwork', error.message);
    console.error(`Disc mutation failed (${request.method} ${id})`, error);
    return problem(500, 'save_failed', 'The change could not be saved. Nothing was changed.');
  }
}

/** `DELETE /api/discs/:id` (remove) and `PATCH /api/discs/:id` (edit fields/cover). */
export default {
  fetch(request: Request): Promise<Response> {
    return handleDiscMutation(request, {
      secret: sessionSecret(),
      store: getStore,
    });
  },
};
