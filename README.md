# discoteca

A personal compact disc collection you can flip through on your phone.

`discoteca` is a single-page app that presents a CD collection as a continuous,
pannable shelf rather than a paginated list. Tap a disc and the case opens: cover
art, pressing details, catalogue number, label, country, and the full track
listing. Metadata comes from [MusicBrainz](https://musicbrainz.org) and cover art
from the [Cover Art Archive](https://coverartarchive.org), so a disc can be added
by scanning the barcode on its case with a phone camera.

It is built as a UI/UX exercise first. The motion is the point: the intent is
that moving through the collection feels like handling the physical objects.

> **Status:** early development. The foundation, tooling and specification are in
> place; the shelf, disc detail view and upload flow are being built against
> [`.kiro/specs/cd-collection`](.kiro/specs/cd-collection).

## Two flows

**Visualise** (the primary flow, public) — browse the shelf, fuzzy-search by
artist, title or track, filter by genre, year, label, country or format, and sort
by any of them. The whole collection index is fetched once and then filtered
entirely on the device, so searching and sorting never wait on the network.

**Add a disc** (private, password-gated) — scan the barcode with the phone
camera, or search by name with autocomplete. Because a barcode does not uniquely
identify a pressing, the app presents ranked candidates and you confirm which one
you are holding. Metadata and cover art are then copied into the project's own
storage rather than hotlinked.

## Stack

| Concern        | Choice                            | Why                                                                                               |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| App            | React 19 + TypeScript, Vite (SPA) | Client-side routing keeps shared-element transitions simple                                       |
| Animation      | [Motion](https://motion.dev)      | `layoutId` shared-element transitions; transform/opacity only                                     |
| Virtualisation | TanStack Virtual                  | The shelf stays smooth at hundreds of discs                                                       |
| Barcode        | `zxing-wasm`                      | WebAssembly decoding; iOS Safari cannot be relied on for the native `BarcodeDetector` (see below) |
| Search         | Fuse.js                           | Fuzzy matching on-device                                                                          |
| Validation     | Zod                               | Third-party JSON is validated at the boundary                                                     |
| API            | Vercel Functions                  | A thin proxy for MusicBrainz plus the write endpoints                                             |
| Storage        | Vercel Blob                       | Fits the free tier; reads are plain CDN hits                                                      |
| Hosting        | Vercel                            | Static SPA plus functions in one free project                                                     |

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
npm run dev
```

| Script               | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `npm run dev`        | Vite dev server                                       |
| `npm run verify`     | Everything CI runs: format, types, lint, tests, build |
| `npm run test:watch` | Tests in watch mode                                   |
| `npm run lint:fix`   | Apply ESLint fixes                                    |
| `npm run build`      | Production build to `dist/`                           |

Camera access needs a secure context. `localhost` counts, but to test scanning
from a real phone on your network, use a tunnel (for example `vercel dev` with a
deployment preview) rather than a bare LAN IP over HTTP.

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
