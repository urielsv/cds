import { z } from 'zod';

import {
  createSessionToken,
  LoginRateLimiter,
  sessionCookie,
  verifyPassword,
} from '../_lib/auth.js';
import { passwordHash, sessionSecret } from '../_lib/env.js';
import {
  clientIp,
  isSameOriginWrite,
  json,
  methodNotAllowed,
  problem,
  readJson,
} from '../_lib/http.js';

const bodySchema = z.object({ passphrase: z.string().min(1).max(1024) });

const limiter = new LoginRateLimiter();

export async function handleLogin(
  request: Request,
  config: { hash: string | undefined; secret: string | undefined; limiter: LoginRateLimiter },
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!isSameOriginWrite(request)) return problem(403, 'forbidden', 'Cross-site request refused.');
  if (!config.hash || !config.secret) {
    return problem(503, 'not_configured', 'Owner sign-in is not configured on this deployment.');
  }

  const ip = clientIp(request);
  const wait = config.limiter.retryAfter(ip);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    return new Response(
      JSON.stringify({
        error: {
          code: 'rate_limited',
          message: 'Too many attempts. Try again later.',
          retryAfter: seconds,
        },
      }),
      {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': String(seconds) },
      },
    );
  }

  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  // Never logged, never stored: the passphrase exists only for this comparison.
  const valid = await verifyPassword(body.data.passphrase, config.hash);
  if (!valid) {
    config.limiter.recordFailure(ip);
    return problem(401, 'wrong_passphrase', 'That passphrase is not right.');
  }

  config.limiter.recordSuccess(ip);
  const token = await createSessionToken(config.secret);
  return json({ signedIn: true }, { headers: { 'set-cookie': sessionCookie(token) } });
}

export default {
  fetch(request: Request): Promise<Response> {
    return handleLogin(request, { hash: passwordHash(), secret: sessionSecret(), limiter });
  },
};
