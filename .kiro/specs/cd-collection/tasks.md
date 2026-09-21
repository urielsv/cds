# Tasks — CD collection

Ordered so that risk is retired early and each group leaves the app working. Each
task notes the requirements it satisfies. `npm run verify` must pass before a task
is considered done.

---

## 0. Foundation — done

- [x] 0.1 Repo, toolchain, lint, format, test, build pipeline
- [x] 0.2 Domain model and Zod schemas (`shared/disc.ts`)
- [x] 0.3 Formatting and slug helpers with tests (`shared/format.ts`)
- [x] 0.4 Candidate ranking with tests (`shared/musicbrainz.ts`)
- [x] 0.5 Design tokens including the motion scale (`src/styles/global.css`)
- [x] 0.6 CI, steering, skills, hooks, spec
- [x] 0.7 Country display helpers with tests (`shared/country.ts`): flag, name and
      region pseudo-code handling. _Satisfies 2.9._
- [x] 0.8 Motion token bridge (`src/motion/tokens.ts`) reading the CSS custom
      properties so JS and CSS cannot drift. _Satisfies 7.1._

---

## 1. Spike: the pannable virtualised shelf — mostly done

- [x] 1.1 Deterministic fixture generator (`src/dev/fixtureCollection.ts`),
      parameterised by count so 150 (today) and 400 (the ceiling) are both easy.
- [x] 1.2 Virtualised 2D grid: one transformed surface, two composed
      `@tanstack/react-virtual` virtualisers, fixed-aspect tiles.
- [x] 1.3 Panning. **Decision: native scrolling on both axes, not a hand-rolled
      pointer transform.** iOS momentum and rubber-band physics are very hard to
      reproduce and native scroll tracks the finger perfectly for free. Desktop
      gets drag-to-pan layered on top, since it has no touch surface.
- [x] 1.4 Virtualisation proven by test (`Shelf.test.tsx`): **42 tiles mount at
      both 150 and 400 discs** on a 390x780 viewport, while the surface grows from
      2368x2100 to 3848x3360. Mounted work is independent of collection size.
- [x] 1.5 Recorded: `TILE_WIDTH` 148, `TILE_HEIGHT` 210, `OVERSCAN` 3, columns
      `ceil(sqrt(n) * 1.3)` floored at what fills the viewport. Zoom deferred —
      panning alone reads well and zoom adds gesture conflicts.
- [ ] 1.6 Still outstanding: profile on a real phone and in Chrome with CPU
      throttled 4x, confirming no frame exceeds 16ms and no layout work occurs
      during a pan. The test above bounds the mounted count but cannot measure
      frame time. _Satisfies 1.3._

## 2. Storage and data access

- [ ] 2.1 Repository interface for the collection: read index, read disc, write
      disc, write index, delete. Storage-agnostic. _Design: swappable backend._
- [ ] 2.2 Blob implementation. Long cache headers on disc documents and images,
      short `stale-while-revalidate` on the index. **No `list()` anywhere.**
      _Satisfies 8.1._
- [ ] 2.3 Local filesystem implementation for development, so the whole app can be
      built without touching a real Blob store or spending operations.
- [ ] 2.4 Seed script that writes the fixture collection through the repository.
- [ ] 2.5 Tests: write ordering puts the index last; a simulated mid-write failure
      leaves the index unchanged. _Satisfies 4.14._

## 3. MusicBrainz and Cover Art Archive access

- [ ] 3.1 MusicBrainz client module: sets `MUSICBRAINZ_USER_AGENT`, serialises
      requests to ≤1/sec, reads `x-ratelimit-*` and backs off, caches by URL.
      _Satisfies 8.2._
- [ ] 3.2 Map a release response to `Disc`, validated through the schema. Record
      real fixtures for: a normal CD, a 2-disc set, `XW` country, a partial date, a
      various-artists release, and one with no cover art.
- [ ] 3.3 Tests for the mapping against every fixture, asserting `discCount` comes
      from `media[]` length and that partial dates survive intact.
- [ ] 3.4 Cover Art Archive client: fetch the image index, pick front and back,
      treat 404 as "no art" rather than failure.
- [ ] 3.5 Image pipeline: fetch, resize to the rendered sizes, generate the base64
      placeholder, store in Blob, return `DiscImage`. _Satisfies 4.11._

## 4. Read-only shelf

The app becomes real here: a browsable collection with no write path.

- [ ] 4.1 App shell, router, and the collection loader that fetches and validates
      `index.json` once into memory.
- [ ] 4.2 Promote the spike into the real `features/shelf/`, with a proper tile
      component: cover, title, artist, placeholder fade-in, explicit dimensions.
      _Satisfies 1.1, 1.2, 1.4, 1.6._
- [ ] 4.3 Touch feedback on tiles within 100ms, using compositor properties only.
      _Satisfies 1.5._
- [ ] 4.4 Preserve scroll position across navigation. _Satisfies 1.7._
- [ ] 4.5 Loading and error states for the index fetch.
- [ ] 4.6 `src/motion/`: typed transitions read from the CSS tokens, plus a
      reduced-motion-aware transition factory. _Satisfies 7.1._

## 5. Disc detail and the shared-element transition

- [ ] 5.1 Detail view rendering every field in 2.2, omitting absent ones, with the
      track listing and total runtime. _Satisfies 2.2, 2.3._
- [ ] 5.2 Track listing that wraps correctly at 320px with long titles.
      _Satisfies 2.4._
- [ ] 5.3 Routing so each disc has its own URL and a cold deep link renders the
      detail view directly. _Satisfies 2.7, 2.8._
- [ ] 5.4 The `layoutId` shared-element transition: grows from the tapped tile,
      collapses back into it. Cross-fade fallback on cold deep link.
      _Satisfies 2.1, 2.6._
- [ ] 5.5 Focus moves into the detail view on open, returns to the tile on close.
      Full keyboard operation. _Satisfies 7.3, 7.4._
- [ ] 5.6 Prefetch the disc document on tile press-down.
- [ ] 5.7 Display personal notes. _Satisfies 2.5._
- [ ] 5.8 Verify reduced motion: still complete, nothing lost. _Satisfies 7.2._

## 6. Search, filter, sort

- [ ] 6.1 Diacritic-folded Fuse.js index over title, artist and track titles,
      weighted so artist and title beat track matches. _Satisfies 3.1, 3.2, 3.4._
- [ ] 6.2 Search input: debounced, live, no network. _Satisfies 3.3._
- [ ] 6.3 Derive facets from the index; filter UI for genre, decade, label, country,
      format, combining. _Satisfies 3.5._
- [ ] 6.4 Sort controls for artist, title, release date, date added, both
      directions. _Satisfies 3.6._
- [ ] 6.5 Memoise the filter-sort pipeline on `[query, filters, sort]` so typing
      never recomputes inside a gesture frame. _Satisfies 8.4._
- [ ] 6.6 Mirror state in URL search params. _Satisfies 3.7._
- [ ] 6.7 Empty state with a one-tap clear. _Satisfies 3.8._
- [ ] 6.8 Animate tiles between positions on reorder, visible-only and with a
      clamped stagger. _Satisfies 3.9._

## 7. Authentication

- [ ] 7.1 `scripts/hash-password.mjs` to generate `UPLOAD_PASSWORD_HASH`. Referenced
      from `.env.example`.
- [ ] 7.2 `POST /api/auth/login`: constant-time scrypt comparison, signed HttpOnly
      Secure SameSite=Strict cookie with short expiry. _Satisfies 6.3, 6.4._
- [ ] 7.3 Per-IP login rate limiting with a lockout window. _Satisfies 6.5._
- [ ] 7.4 Session verification helper that every write route uses. _Satisfies 6.2._
- [ ] 7.5 `GET /api/auth/session` and `POST /api/auth/logout`. _Satisfies 6.6._
- [ ] 7.6 Passphrase prompt UI; gate the add flow's entry point. _Satisfies 6.1,
      4.1._
- [ ] 7.7 Tests: a write route rejects a missing, malformed, expired and tampered
      cookie. These must all be explicit.

## 8. Lookup endpoints

- [ ] 8.1 `GET /api/lookup/barcode` — normalise, query each variant, merge and
      de-duplicate by MBID, rank, return candidates. Authenticated.
- [ ] 8.2 `GET /api/lookup/search` — text search for autocomplete. Authenticated.
- [ ] 8.3 `GET /api/lookup/release/:mbid` — full detail with the full `inc=` set.
- [ ] 8.4 Annotate each candidate with cover-art availability for ranking.
- [ ] 8.5 Tests against recorded fixtures, including the real two-result Daft Punk
      barcode where neither result is the CD.

## 9. Barcode scanning

Read `.kiro/skills/mobile-camera-scan/SKILL.md` before starting.

- [ ] 9.1 `zxing-wasm` decoder limited to EAN-13, UPC-A, EAN-8 and ITF-14.
- [ ] 9.2 Native `BarcodeDetector` self-test at startup against a known image;
      fall back to WASM permanently for the session if it fails or times out.
      **A feature check alone is not acceptable.**
- [ ] 9.3 Camera view: rear camera, `playsInline`, `muted`, requested from a user
      gesture, tracks stopped on close, unmount and `visibilitychange`.
      _Satisfies 4.2._
- [ ] 9.4 Throttled decode loop on a cropped, downscaled frame; accept only after
      two consecutive identical reads.
- [ ] 9.5 Guide box plus haptic, visual and textual confirmation showing the digits.
- [ ] 9.6 Manual barcode entry. _Satisfies 4.6._
- [ ] 9.7 Decode from a still photo. _Satisfies 4.7._
- [ ] 9.8 Permission-denied path leading straight to manual entry.
      _Satisfies 4.8._
- [ ] 9.9 Tests for decode-and-confirm against fixture images. Then test the camera
      path on a real phone over HTTPS — a desktop webcam does not exercise the iOS
      bugs that matter.

## 10. Add a disc

- [ ] 10.1 Flow scaffolding where scan, type, photo and name search all converge on
      one confirm-and-review step.
- [ ] 10.2 Candidate list showing cover, year, country, label, catalogue number,
      format and track count. Never auto-accept, not even a single result.
      _Satisfies 4.3, 4.4._
- [ ] 10.3 Name search with autocompleting suggestions. _Satisfies 4.5._
- [ ] 10.4 Review-and-edit step with personal notes. _Satisfies 4.9._
- [ ] 10.5 Client-side canvas downscaling of user photos before upload.
      _Satisfies 4.10._
- [ ] 10.6 `POST /api/discs`: ingest per the skill, writing the index last, cleaning
      up with `del()` on failure. _Satisfies 4.11, 4.14._
- [ ] 10.7 Duplicate detection by MBID, then barcode, then normalised
      artist+title+year. Warn, do not block. _Satisfies 4.13._
- [ ] 10.8 Refresh the in-memory collection so the disc appears without a reload.
      _Satisfies 4.12._
- [ ] 10.9 Motion for the flow: the new disc settles into the shelf rather than
      appearing.

## 11. Edit and delete

- [ ] 11.1 `PATCH /api/discs/:id` for field edits and MusicBrainz re-sync.
      _Satisfies 5.1._
- [ ] 11.2 `DELETE /api/discs/:id`, removing images and updating the index.
      _Satisfies 5.2._
- [ ] 11.3 Edit and delete UI, delete behind a confirmation. _Satisfies 5.2._
- [ ] 11.4 Honour `manualFields` on re-sync: never overwrite a hand-set field, and
      show which fields are overridden. _Satisfies 5.3._
- [ ] 11.5 Let the owner clear an override and fall back to the provider value.
      _Satisfies 5.4._

## 12. Polish and verification

- [ ] 12.1 Run the `motion-reviewer` agent over all animation code; fix findings.
- [ ] 12.2 Accessibility pass: keyboard-only traversal of every flow, screen reader
      on shelf and detail, contrast audit, alt text on all images.
      _Satisfies 7.3, 7.5, 7.7._
- [ ] 12.3 Confirm no state change is signalled by animation alone.
      _Satisfies 7.6._
- [ ] 12.4 Re-profile the shelf with 300 discs under 4x throttle and confirm no
      regression since the spike. _Satisfies 1.3._
- [ ] 12.5 Audit every storage call site: no `list()`, writes bounded per action,
      long cache headers in place. _Satisfies 8.1._
- [ ] 12.6 Fault injection: MusicBrainz down, rate-limited, CAA 404, camera denied,
      session expired mid-form, save failing midway. Each must degrade as designed.
      _Satisfies 8.3._
- [ ] 12.7 Confirm browsing a loaded collection issues no requests for search,
      filter or sort. _Satisfies 8.4._
- [ ] 12.8 Deploy, set environment variables, link the Blob store, and verify the
      whole thing on a phone over cellular.

---

## Sequencing notes

Group 1 gates everything visual — do not build tiles on an unproven grid.
Groups 2 and 3 are independent of each other and can go in parallel.
Group 4 needs 1, 2 and 3 (or at least the seed script from 2.4).
Group 7 gates 8, which gates 9 and 10.
Group 12 runs last but 12.1 and 12.2 are worth running early on whatever exists.
