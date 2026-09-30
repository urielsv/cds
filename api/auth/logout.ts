import { clearedSessionCookie } from '../_lib/auth.js';
import { isSameOriginWrite, json, methodNotAllowed, problem } from '../_lib/http.js';

/**
 * Clears the cookie. Deliberately does not require a valid session: signing
 * out with an expired cookie should still leave the browser signed out.
 */
export default {
  fetch(request: Request): Response {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    if (!isSameOriginWrite(request))
      return problem(403, 'forbidden', 'Cross-site request refused.');
    return json({ signedIn: false }, { headers: { 'set-cookie': clearedSessionCookie() } });
  },
};
