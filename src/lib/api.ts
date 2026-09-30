/**
 * The browser's client for our own `/api` routes. Same-origin only, so the
 * HttpOnly session cookie rides along automatically and is never visible to
 * script.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown } & Record<string, unknown>;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    response = await fetch(path, { ...init, credentials: 'same-origin', headers });
  } catch {
    throw new ApiError(0, 'offline', 'Could not reach the server. Check your connection.', {});
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // A static host without the functions (plain `vite dev`) answers with HTML.
    throw new ApiError(
      response.status,
      'no_api',
      'The admin API is not running here. Use `vercel dev` locally, or a deployment.',
      {},
    );
  }

  if (!response.ok) {
    const error = (body as ErrorBody | null)?.error ?? {};
    throw new ApiError(
      response.status,
      typeof error.code === 'string' ? error.code : 'error',
      typeof error.message === 'string'
        ? error.message
        : `Request failed (${String(response.status)}).`,
      error,
    );
  }
  return body as T;
}
