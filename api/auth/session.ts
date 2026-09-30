import { isOwner } from '../_lib/auth.js';
import { sessionSecret } from '../_lib/env.js';
import { json, methodNotAllowed } from '../_lib/http.js';

/** Reports whether the caller holds a valid owner session. Never errors. */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return json({ signedIn: await isOwner(request, sessionSecret()) });
  },
};
