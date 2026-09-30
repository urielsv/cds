# MyCDs

A personal compact disc collection you can flip through on your phone.

`MyCDs` is a single-page app that presents a CD collection as one continuous wall
of album covers — edge to edge, no borders, no captions — that you pan and pinch
like a map or a photo library. Tap a cover and it lifts out of the wall into the
full record: pressing details, catalogue number, label, country and the track
listing. Metadata comes from [MusicBrainz](https://musicbrainz.org) and cover art
from the [Cover Art Archive](https://coverartarchive.org).

It is built as a UI/UX exercise first. The motion is the point: the intent is
that moving through the collection feels like handling the physical objects.

> **Status:** browsing, search, filters, arranging, rating and the
> add-an-album flow work. Barcode scanning with the camera, and editing or
> deleting a disc, are next — tracked in
> [`.kiro/specs/cd-collection`](.kiro/specs/cd-collection).
>
> Run `npm run dev` to browse a demo wall of 220-odd real albums, with real
> metadata and artwork from MusicBrainz and the Cover Art Archive.

## Two flows

**Visualise** (the primary flow, public) — the wall is laid out roughly in the
shape of the screen, from 1×1 for a single disc up to N×M for the whole
collection, on a white page with no chrome except one floating pane of glass.

Drag to pan, pinch or ctrl/⌘-scroll to zoom, from one cover filling the screen
out to the entire collection at once. Arrow keys move between covers, and
`+`/`-`/`0` zoom for keyboard users.

Everything **snaps to whole covers**. Zoom rests only where an exact number of
covers spans the screen — 1, 2, 3, 4, 5, 6, 8, 10… across — and a pan lands on a
row and column, flush at the edges of the wall, so a sliver of a cover is never
left at the screen edge. A flick throws the wall towards the cell it was aimed
at and arrives in about 200ms rather than drifting to a halt: the grid clicks
into place instead of coasting.

Covers can be **all the same size, or sized by rating**. Rate an album 1–5 stars
from its detail view, switch the wall to “By rating”, and your five-star albums
are drawn three cells wide and four-star albums two, with the rest packed in
around them — a wall that shows at a glance what you actually care about.

A floating glass bar at the bottom holds search, filters and arrangement.
Searching and filtering never hide anything: covers that do not match are washed
out in place, so the collection keeps its shape and matches read as a pattern
within it (or, optionally, gather at the start).

Search is fuzzy and reaches the metadata, not just the name: artist, title and
track titles first, then label, genre, format, country (code or name), release
year, decade and barcode. Words narrow rather than replace, so “daft discovery”
finds the album, “cerati 1999” finds that year's pressing, and “argentina trip
hop” works too. Filters cover decade, release year range, genre, artist, label,
country and format; the wall can be arranged by date added, rating, colour,
artist, title, year, genre, label or country. The whole collection index is
fetched once and filtered entirely on the device, and the current view lives in
the URL so it can be shared.

**Add an album** (owner only, passphrase-gated) — sign in from the foot of the
filter panel (or open `/#admin`), tap `+`, and type an artist and title, the
digits under the barcode, or paste a MusicBrainz link. Because a barcode does not
identify a pressing, you always pick the exact release from ranked candidates
(CD pressings first). The front cover is fetched and resized on your phone, you
can swap in your own photo, and the album settles into the wall.

## Stack

| Concern    | Choice                            | Why                                                                                               |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| App        | React 19 + TypeScript, Vite (SPA) | Client-side routing keeps shared-element transitions simple                                       |
| Animation  | [Motion](https://motion.dev)      | `layoutId` shared-element transitions; transform/opacity only                                     |
| Wall       | Own camera + windowing            | One transformed surface; only covers near the screen mount, so frame cost ignores collection size |
| Artwork    | Prefetched around the viewport    | Covers a few rows out are warmed at low priority, so panning reveals cached images                |
| Barcode    | `zxing-wasm`                      | WebAssembly decoding; iOS Safari cannot be relied on for the native `BarcodeDetector` (see below) |
| Search     | Fuse.js                           | Fuzzy matching on-device                                                                          |
| Validation | Zod                               | Third-party JSON is validated at the boundary                                                     |
| API        | Vercel Functions                  | A thin proxy for MusicBrainz plus the write endpoints                                             |
| Storage    | Vercel Blob                       | Fits the free tier; reads are plain CDN hits                                                      |
| Hosting    | Vercel                            | Static SPA plus functions in one free project                                                     |

### Why the barcode scanner uses WebAssembly

The obvious choice is the native [Barcode Detection
API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API), but
WebKit's implementation has been broken since iOS 18 ([WebKit bug
281848](https://bugs.webkit.org/show_bug.cgi?id=281848)). Since this app is used
mainly from a phone, scanning decodes through `zxing-wasm` by default and only
uses the native API where it is both present and verified working at runtime.
Manual barcode entry and decoding from a still photo are always available as
fallbacks.

## Running locally

Requires Node 24 (see [`.nvmrc`](.nvmrc)).

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # the wall, against the demo collection
vercel dev                   # the wall plus the /api functions, for the add flow
```

`npm run dev` serves only the front end; the owner sign-in reports that the API
is not running. The add flow needs the functions, so use `vercel dev` (with a
linked Blob store) or a preview deployment.

### First deployment

1. Link a Vercel Blob store to the project (this injects `BLOB_READ_WRITE_TOKEN`).
2. Set `UPLOAD_PASSWORD_HASH` (from `node scripts/hash-password.mjs`),
   `SESSION_SECRET` and `MUSICBRAINZ_USER_AGENT`.
3. Deploy, open `/#admin`, sign in and add the first album.
4. The add flow then shows the public `VITE_COLLECTION_INDEX_URL`. Set it and
   redeploy; from then on visitors see the real collection instead of the demo.

| Script                       | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `npm run dev`                | Vite dev server                                       |
| `npm run verify`             | Everything CI runs: format, types, lint, tests, build |
| `npm run test:watch`         | Tests in watch mode                                   |
| `npm run lint:fix`           | Apply ESLint fixes                                    |
| `npm run build`              | Production build to `dist/`                           |
| `node scripts/seed-demo.mjs` | Rebuild the demo collection from MusicBrainz          |

Camera access needs a secure context. `localhost` counts, but to test scanning
from a real phone on your network, use a tunnel (for example `vercel dev` with a
deployment preview) rather than a bare LAN IP over HTTP.

## The demo collection

With no collection configured, the app shows
[`src/dev/demoCollection.json`](src/dev/demoCollection.json): around 220 real
albums, resolved against MusicBrainz by
[`scripts/seed-demo.mjs`](scripts/seed-demo.mjs) from the list in
[`scripts/demo-albums.txt`](scripts/demo-albums.txt). For each line it finds the
release group, picks the earliest CD pressing that has front cover art, and maps
it with the same `shared/` code the real ingest uses, so the demo exercises the
real data model rather than a parallel one.

Two things about it are deliberately not production behaviour, and both are
demo-only:

- **The artwork is referenced at the Cover Art Archive rather than copied.** The
  images belong to their owners and this repository is public, so the demo
  hotlinks them; a real collection mirrors artwork into its own Blob storage at
  ingest, as the [steering notes](.kiro/steering/api-integration.md) require.
  The visible cost is speed — archive.org can take a second per cover, which is
  why the wall warms the covers around the viewport in advance.
- **The ratings are synthetic**, derived from each disc's id. They exist so the
  arrange-by-rating wall has something to shape; nobody has actually rated these.

Re-running the seed is safe and mostly offline: MusicBrainz responses and cover
colours are cached under `node_modules/.cache/seed-demo`.

## Configuration

All configuration is via environment variables; see
[`.env.example`](.env.example) for the full list and how to generate each value.

`MUSICBRAINZ_USER_AGENT` is not optional in practice. MusicBrainz requires a
descriptive `User-Agent` naming the application and a contact address, and
throttles or blocks clients that omit it. A browser cannot set its own
`User-Agent`, which is why MusicBrainz is reached through a serverless function
rather than called directly from the page.

## Deployment

Vercel's Git integration builds every push to a preview URL and every merge to
`main` to production. GitHub Actions runs the checks
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) but does not deploy, so
there is only one deployment path.

## Data sources and attribution

Release metadata is from **MusicBrainz**, released under
[CC0](https://musicbrainz.org/doc/About/Data_License) for the core data.
Cover art is from the **Cover Art Archive**, a joint project of MusicBrainz and
the Internet Archive; individual images carry their own licences and remain the
property of their respective owners. Both are free, community-maintained services
— please [donate to MetaBrainz](https://metabrainz.org/donate) if you build on
them.

This project's own source code is MIT licensed (see [LICENSE](LICENSE)). That
licence covers the code only, not the album artwork or metadata it displays.

## A note on access

The browse experience is public. Adding or editing discs is gated behind a single
shared passphrase, which suits a one-person collection but is not a general
authentication system: there are no user accounts, no per-user permissions and no
audit trail of who changed what. Anyone holding the passphrase can modify the
whole collection.
