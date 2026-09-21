# Stack and the constraints behind it

## Toolchain

| Thing       | Version  | Notes                                              |
| ----------- | -------- | -------------------------------------------------- |
| Node        | 24.17.0  | Pinned in `.nvmrc`; CI reads that file             |
| Package mgr | npm      | `package-lock.json` is committed; CI uses `npm ci` |
| TypeScript  | 6.0.3    | **Not** 7.x — see below                            |
| ESLint      | 9.39.5   | **Not** 10.x — see below                           |
| Vite        | 8.x      | Rolldown-based; some Rollup config shapes changed  |
| Tests       | Vitest 5 | jsdom environment, Testing Library                 |

Dependencies are pinned to **exact versions** (no `^`). Dependabot proposes
upgrades in grouped PRs. Do not loosen a version range to resolve a conflict;
resolve the conflict.

## Two version ceilings that are deliberate

**TypeScript stays on 6.0.3.** `typescript-eslint@8.70.0` declares
`typescript >=4.8.4 <6.1.0`. Upgrading to TypeScript 7 (the native port) would
disable type-aware linting, which is doing real work on this codebase — it is what
catches unchecked third-party JSON access. Revisit when typescript-eslint supports
TS 7.

**ESLint stays on 9.39.5.** `eslint-plugin-jsx-a11y@6.10.2` (last published
2024-10-26) peers `eslint` up to `^9` only, and npm hard-fails the conflict.
ESLint 9 is flagged end-of-life, which is acceptable: ESLint is a devDependency
that never ships to a user, so its EOL status is a maintenance concern rather than
a security exposure. Accessibility linting is worth more here. Revisit when
jsx-a11y ships ESLint 10 support.

If you hit either ceiling, do not paper over it with `--legacy-peer-deps` or npm
`overrides`. Raise it.

## Framework: a real SPA, not a meta-framework

Vite + React with client-side routing, deployed as static assets plus a few
serverless functions. This is a deliberate choice over Next.js:

- Shared-element transitions between the shelf and a disc need both views alive in
  the same client-side tree at once. A server-rendered router fights this.
- Image optimisation happens **once at ingest**, not per request: when a disc is
  added, its artwork is resized and stored at the sizes the UI needs. That removes
  any dependence on a hosted image-transformation quota.

## Persistence: Vercel Blob holding JSON documents

Two document kinds in a Blob store:

- `collection/index.json` — every disc, trimmed to what the shelf tile needs.
  Fetched once per session, then all searching, filtering and sorting happens
  in memory on the device.
- `collection/discs/<id>.json` — the full record, fetched when a disc is opened.

Plus the image blobs.

**Why not Postgres.** Neon's free tier would work, but it adds a cold start to
every read, caps at 0.5 GB and 100 compute-hours, and buys query capability we do
not use: the client already holds the whole collection and filters locally. For a
single-writer, read-heavy collection of a few hundred discs, JSON on a CDN is
faster and simpler.

**Access goes through a repository interface** (`shared/` + `api/`), so the
storage layer can be swapped without touching feature code. Swap to Postgres if
any of these become true: more than one concurrent writer, more than ~2,000 writes
a month, a need for server-side querying, or the collection outgrowing a
single-document index.

### Free-tier rules you must not break

Vercel Blob's Hobby allowance is 1 GB stored, 10,000 simple operations, 2,000
advanced operations, and 10 GB transfer per month. Exceeding it locks the store
for 30 days — there is no overage billing to absorb a mistake. Therefore:

- **Never call `list()` at runtime.** It is an advanced operation. `index.json` is
  the authoritative listing.
- Every write is an advanced operation. Batch them; do not write per keystroke.
- Serve images with long cache headers. A cache hit costs nothing; a miss counts.
- `del()` is free.

## Barcode scanning: WebAssembly first

Decode with `zxing-wasm`. The native `BarcodeDetector` API may be used **only**
when it is both feature-detected and confirmed working by a runtime self-test,
because WebKit's implementation has been broken since iOS 18 (WebKit bug 281848)
and this app is used primarily from iPhones. A `'BarcodeDetector' in window` check
alone is not sufficient and will produce a scanner that silently never scans.

Always offer manual barcode entry and decode-from-photo as fallbacks. The camera
is a convenience, never the only route.

## Security posture

Browsing is public. Writing requires a single shared passphrase: the server checks
it against a hash held in an environment variable and issues a short-lived signed
HttpOnly cookie. The plaintext passphrase is never stored or logged.

Be clear-eyed that this is a lock on a personal shed, not an authentication
system. There are no accounts, no per-user permissions and no audit trail. Every
mutating endpoint must verify the session cookie server-side — never rely on the
client hiding the upload UI. Login attempts must be rate-limited.

Secrets live only in environment variables, never in client code. Anything
reachable from `src/` is public, including every `VITE_`-prefixed variable.
