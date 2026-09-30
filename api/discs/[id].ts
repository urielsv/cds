import { isOwner } from '../_lib/auth.js';
import { getStore, sessionSecret } from '../_lib/env.js';
import { isSameOriginWrite, json, methodNotAllowed, problem, readJson } from '../_lib/http.js';
import { DiscNotFoundError, rateDisc, rateRequestSchema } from '../_lib/rate.js';
import { type CollectionStore } from '../_lib/store.js';

/** `PATCH /api/discs/:id` — currently the rating only. */
export async function handlePatchDisc(
  request: Request,
  deps: { secret: string | undefined; store: () => CollectionStore },
): Promise<Response> {
  if (request.method !== 'PATCH') return methodNotAllowed(['PATCH']);
  if (!isSameOriginWrite(request)) return problem(403, 'forbidden', 'Cross-site request refused.');
  if (!(await isOwner(request, deps.secret))) {
    return problem(401, 'signed_out', 'Your session has expired. Sign in again.');
  }

  // The id is the last path segment: `/api/discs/daft-punk-discovery-2001`.
  const id = decodeURIComponent(
    new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '',
  );
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return problem(400, 'invalid_id', 'That is not a disc id.');
  }

  const body = await readJson(request, rateRequestSchema);
  if (!body.ok) return body.response;

  try {
    const entry = await rateDisc(id, body.data.rating, { store: deps.store() });
    return json({ entry });
  } catch (error) {
    if (error instanceof DiscNotFoundError) {
      return problem(404, 'not_found', 'That disc is not in the collection.');
    }
    console.error('Rating failed', error);
    return problem(500, 'save_failed', 'The rating could not be saved.');
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    return handlePatchDisc(request, { secret: sessionSecret(), store: getStore });
  },
};
