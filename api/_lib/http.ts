/**
 * Small helpers shared by the function handlers.
 *
 * Files and folders under `api/` that start with an underscore are not turned
 * into endpoints by Vercel, which is why this lives in `api/_lib/`.
 */

import { type z } from 'zod';

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** A consistent error shape the client can switch on without parsing prose. */
export function problem(status: number, code: string, message: string, extra = {}): Response {
  return json({ error: { code, message, ...extra } }, { status });
}

export function methodNotAllowed(allowed: readonly string[]): Response {
  return new Response(null, { status: 405, headers: { allow: allowed.join(', ') } });
}

/**
 * Rejects cross-site writes. SameSite=Strict already keeps the session cookie
 * off cross-site requests; this is the belt to that pair of braces, and it
 * also refuses form posts, which cannot set a JSON content type.
 */
export function isSameOriginWrite(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  if (request.method !== 'GET' && !type.toLowerCase().startsWith('application/json')) {
    return false;
  }
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Parses and validates a JSON body. Returns a 400 response on any failure. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: problem(400, 'invalid_json', 'The request body is not JSON.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: problem(400, 'invalid_body', 'The request body is not valid.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Best-effort client IP for rate limiting. Vercel sets x-forwarded-for. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : (request.headers.get('x-real-ip') ?? 'unknown');
}
