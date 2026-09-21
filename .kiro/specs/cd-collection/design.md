# Design — CD collection

## Shape of the system

```
         ┌───────────────── browser (SPA) ─────────────────┐
         │  shelf ⇄ disc detail ⇄ upload                   │
         │  in-memory collection, Fuse.js, filters, sort   │
         └───────┬──────────────────────────┬──────────────┘
                 │ 1. index.json (once)     │ 3. writes
                 │ 2. disc/<id>.json        │    (cookie-gated)
                 ▼                          ▼
        ┌─────────────────┐        ┌──────────────────────┐
        │  Blob CDN       │        │  Vercel Functions    │
        │  (public read)  │        │  /api/*              │
        └─────────────────┘        └──────┬───────────────┘
                 ▲                        │ server-side only
                 └── writes ──────────────┤
                                          ▼
                              MusicBrainz + Cover Art Archive
```

The browser reads data **directly from the Blob CDN**, not through a function.
Reads are therefore free, edge-cached, and have no cold start. Functions exist only
for things the browser cannot or must not do: reaching MusicBrainz with a proper
User-Agent, and writing.

## Read path

**`collection/index.json`** — the entire collection, trimmed to
`DiscSummary` + thumbnail (`collectionIndexSchema` in `shared/disc.ts`). Fetched
once on load, validated, held in memory. At ~350 bytes per disc, 500 discs is about
175 KB uncompressed and well under 50 KB gzipped.

Everything in requirement 3 — search, filter, sort — operates on that in-memory
array. No network traffic, no latency, no spinner.

**`collection/discs/<id>.json`** — the full `Disc`, fetched when a disc opens.
Prefetched on tile press-down so it is usually already there by the time the open
animation finishes.

Cache headers: `index.json` gets a short max-age with `stale-while-revalidate` so a
newly added disc appears quickly; disc documents and images are immutable and get a
long max-age.

### Why not a database

Neon's free Postgres would work but adds a cold start to every read, and buys
server-side querying that is unnecessary because the client already holds the whole
collection. JSON on a CDN is faster, simpler and free. Storage access is behind a
repository interface so this can change; the triggers for revisiting are in
`.kiro/steering/tech.md`.

## Write path

All writes go through `/api` and require the session cookie.

The ordering matters, because there are no transactions:

1. `PUT collection/discs/<id>.json`
2. upload image blobs
3. `PUT collection/index.json` — **last**

The index is what the app reads, so it must never reference a document that does not
exist yet. If any step fails, `del()` what was written (deletes are free) and leave
the index alone. The collection is then exactly as it was — satisfying requirement
4.14.

Because there is one writer, there is no locking. Read the index, mutate in memory,
write once.

## API surface

| Route                       | Method | Auth | Purpose                                       |
| --------------------------- | ------ | ---- | --------------------------------------------- |
| `/api/auth/login`           | POST   | –    | Verify passphrase, set cookie. Rate-limited.  |
| `/api/auth/logout`          | POST   | ✓    | Clear cookie                                  |
| `/api/auth/session`         | GET    | –    | Report whether the caller has a valid session |
| `/api/lookup/barcode`       | GET    | ✓    | Barcode → ranked candidates                   |
| `/api/lookup/search`        | GET    | ✓    | Text → ranked candidates (autocomplete)       |
| `/api/lookup/release/:mbid` | GET    | ✓    | Full release detail                           |
| `/api/discs`                | POST   | ✓    | Create a disc (ingest)                        |
| `/api/discs/:id`            | PATCH  | ✓    | Edit fields, or re-sync from MusicBrainz      |
| `/api/discs/:id`            | DELETE | ✓    | Remove a disc                                 |

Lookup routes are authenticated too: they are only used by the add flow, and leaving
them open would turn the deployment into an unthrottled public MusicBrainz proxy
that would get its IP blocked.

Note there is no read route for the collection. That is deliberate — the browser
reads the Blob CDN directly.

### MusicBrainz proxy behaviour

One module owns all outbound MusicBrainz traffic and enforces: the
`MUSICBRAINZ_USER_AGENT` header, serialised requests at ≤1/sec, reading
`x-ratelimit-remaining` to back off pre-emptively, and an in-memory cache keyed by
URL. Release data for an MBID is immutable for our purposes, so cache hits are free
wins.

## Authentication

Passphrase → scrypt hash compared against `UPLOAD_PASSWORD_HASH` in constant time →
signed JWT (`jose`, HS256) in an HttpOnly, Secure, SameSite=Strict cookie with a
short expiry.

Every write route verifies the cookie server-side before doing anything. The client
hiding the upload button is a convenience, not a control.

Rate limiting on login: a small in-memory counter per IP with a lockout window. This
resets when the function instance recycles, which is imperfect but adequate against
the realistic threat — an opportunistic script, not a determined attacker. If that
proves insufficient, the fix is a durable counter, and it is a small change.

**Understood limitation:** one shared passphrase means no accounts, no per-user
permissions and no audit trail. Anyone with the passphrase can change everything.
That is an accepted trade-off for a personal collection, stated in the README so it
is not mistaken for a real auth system.

## The shelf

A single scroll container holding one transformed inner surface. Panning moves that
one element; individual tiles never get their own position updates.

Virtualised with two `@tanstack/react-virtual` virtualisers composed into a grid,
mounting only tiles near the viewport plus a small overscan. This is what makes
requirement 1.3 achievable — the frame cost stops depending on collection size.

Tiles are fixed-aspect so the grid geometry is known before any image loads,
satisfying 1.4. Cover art is `loading="lazy"`, dimensioned, and fades up from the
stored base64 placeholder.

Scroll position is kept outside the component tree so it survives the detail view
(1.7).

**This is the riskiest part of the build**, because "pannable 2D virtualised grid
with smooth gestures" has many ways to be subtly janky. It gets a spike task before
anything is built on top of it.

## Shelf → disc transition

The core animation. A `motion` element on the tile and one on the detail view share
a `layoutId` derived from the disc id; Motion turns the change into a transform-only
FLIP animation, so the detail view grows out of the tile (2.1) and collapses back
into it (2.6).

Both views must be in the same client-side React tree for this to work, which is the
concrete reason this app is a client-routed SPA rather than server-rendered.

Focus moves into the detail view on open and returns to the tile on close (7.4).

On a cold deep link (2.7) there is no originating tile, so the detail view
cross-fades in instead. The transition degrades; the destination does not.

## Search, filter, sort

All client-side over the in-memory array:

- **Fuzzy search** — Fuse.js over title, artist and track titles, weighted so
  artist and title outrank track matches. Both the index and the query are
  diacritic-folded so 3.4 works symmetrically.
- **Filters** — derived facet lists (genres, decades, labels, countries, formats)
  computed once from the index. Filters intersect.
- **Sort** — comparators over the filtered result.

Input is debounced, and the filter-sort pipeline is memoised on
`[query, filters, sort]`, so a keystroke does not recompute during a gesture frame.

State lives in URL search params (3.7), which makes filtered views shareable and
gives back-button behaviour for free.

Reordering uses Motion's `layout` prop so tiles slide to new positions (3.9). This
is capped: only visible tiles animate, and the stagger is clamped so the last tile
does not arrive seconds late.

## Add-a-disc flow

```
passphrase → [scan | type barcode | photo | name search]
           → ranked candidates → confirm pressing
           → full release fetch → review & edit → save
```

Every branch converges on the same confirm-and-review step, so there is one
validation and save path regardless of how the disc was identified.

### Scanning

`zxing-wasm` is the decoder. The native `BarcodeDetector` is used only when it both
exists _and_ passes a startup self-test against a known barcode image, because
WebKit's implementation has been broken since iOS 18 and a bare feature check
produces a scanner that shows a preview and silently never scans.

Decode is throttled to a few frames per second on a cropped, downscaled frame, and a
value is accepted only after two consecutive identical reads — glossy jewel cases
produce transposed digits from single frames.

Manual entry, photo decode and name search are always present (4.6–4.8), and a
permission denial routes straight to manual entry.

### Candidate disambiguation

Non-negotiable, and the thing most likely to be "simplified" away by mistake.
Barcode `724384960650` returns two releases and **neither is the CD**. So:
`rankCandidates()` scores physical CD media far above digital, and the user always
confirms — including when there is exactly one result (4.3).

### Ingest

Per `.kiro/skills/add-disc-ingest/SKILL.md`: fetch the full release in one request
with the full `inc=` set, map explicitly into `Disc`, copy artwork from the Cover
Art Archive into Blob at the sizes the UI renders, generate placeholders, then write
in the order above.

Artwork is resized **at ingest, once**, which is why no request-time image
transformation service is needed (4.11).

User photos are downscaled in the browser with a canvas before upload — the phone
does that work, keeping uploads small on cellular and functions small.

Duplicate detection (4.13) matches on release MBID first, then on barcode, then on
normalised artist+title+year, and warns rather than blocks — owning two copies of a
disc is legitimate.

## Motion system

`src/motion/` owns: reading the CSS duration and easing tokens into typed
transition objects, a `useReducedMotion`-aware transition factory, and the shared
variants. Components compose these; they never write their own timings (7.1).

The reduced-motion strategy is deliberately not "turn animation off": CSS tokens
collapse to ~1ms globally, and JS-driven motion drops translation, parallax and
scale while keeping cross-fades, reaching the same end state (7.2).

## Error handling

| Failure                   | Behaviour                                              |
| ------------------------- | ------------------------------------------------------ |
| `index.json` unreachable  | Explain, offer retry. Nothing else works without it.   |
| Disc document unreachable | Show what the index already has, retry detail in place |
| Cover art missing (404)   | Placeholder. Not an error — many releases have no art. |
| MusicBrainz down          | Add flow falls back to manual entry (8.3)              |
| MusicBrainz rate-limited  | Back off and tell the user to wait, do not hammer      |
| Camera denied             | Straight to manual entry, explain how to re-enable     |
| Save fails midway         | Clean up with `del()`, index untouched (4.14)          |
| Session expired           | Re-prompt for passphrase, preserve entered form data   |

"Not found" and "service unavailable" are always distinguished, because the user's
next action differs.

## Testing

- `shared/` — thorough unit tests. Pure functions; already started.
- Mapping MusicBrainz → `Disc` — fixture-driven, using recorded real responses
  including awkward cases: multi-disc sets, `XW` country, partial dates, missing
  art, various-artists credits.
- Ranking — the real two-candidate Daft Punk case is already a test.
- Components — observable behaviour only: what is rendered, what a tap does, where
  focus goes. Never intermediate animation frames.
- Ingest ordering — assert the index is written last and that a simulated failure
  leaves the index unchanged.
- Shelf performance — measured manually with a CPU-throttled profile against a
  generated 300-disc fixture. Not automated; the spike task records the numbers.

## Decisions worth restating

| Decision                       | Because                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| Client reads Blob CDN directly | Free, cached, no cold start; functions would add cost and latency |
| Whole index loaded up front    | Makes search/filter/sort instant with zero requests               |
| SPA, not server-rendered       | Shared-element transition needs both views in one client tree     |
| Images resized at ingest       | No dependence on a request-time transformation quota              |
| Lookup routes authenticated    | Otherwise it is an open MusicBrainz proxy that gets IP-blocked    |
| Index written last             | Only safe ordering without transactions                           |
| Always confirm the pressing    | A barcode does not identify a pressing                            |
| WASM barcode decoding          | WebKit's native implementation is broken and fails silently       |
