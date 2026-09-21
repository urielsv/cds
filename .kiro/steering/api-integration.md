---
inclusion: fileMatch
fileMatchPattern: '{api/**,shared/musicbrainz*,shared/disc*,src/lib/**,scripts/**}'
---

# Talking to MusicBrainz, the Cover Art Archive and Blob storage

All of the following was verified against the live services, not inferred from
documentation. Treat the stated behaviours as measured facts.

## MusicBrainz

Base: `https://musicbrainz.org/ws/2/`. No API key. Always append `&fmt=json`.

**Call it only from `api/`, never from the browser.** MusicBrainz requires a
descriptive `User-Agent` naming the app and a contact address, and throttles or
blocks clients that send a generic one. A browser cannot set its own `User-Agent`,
so a direct call from the page is a violation that happens to work until it does
not. The value comes from `MUSICBRAINZ_USER_AGENT`.

Their CORS policy is open (`access-control-allow-origin: *`), which makes a direct
browser call _technically_ succeed. That is not permission to make one.

### Rate limits

Roughly one request per second per source IP. Responses carry
`x-ratelimit-limit`, `x-ratelimit-remaining` and `x-ratelimit-reset` — read them
and back off rather than discovering the limit by being blocked. Serverless
functions share outbound IPs, so the budget is not exclusively ours.

Never fan out concurrent requests. Serialise, and cache aggressively: release data
for a specific MBID is effectively immutable for our purposes.

### Useful requests

Search by barcode:

```
/ws/2/release?query=barcode:724384960650&fmt=json
```

Full detail for one release:

```
/ws/2/release/{mbid}?fmt=json&inc=recordings+artist-credits+labels+release-groups+media+discids+genres
```

That `inc` set returns everything the detail view needs — tracklist with
durations, label and catalogue number, packaging, format per medium, genres — in a
single ~35 KB response. Request it once and map it; do not make follow-up calls
for fields already present.

### A barcode does not identify a pressing

This is the most important thing to know about the upload flow. Barcode
`724384960650` returns **two** releases, and neither is the CD — both are digital
issues. The same barcode is reused across reissues and formats.

So: always rank candidates and let the user confirm. `rankCandidates()` in
`shared/musicbrainz.ts` scores physical CD media far above digital, which is the
right prior for a CD collection, but it is a prior and not an answer. Never
auto-accept a single result without showing the user what was matched.

Measured: MusicBrainz's search index normalises a leading zero, so the 12-digit
UPC-A and the zero-padded 13-digit EAN form return identical results.
`barcodeSearchVariants()` still emits both because that normalisation is an
undocumented convenience of their Lucene index. De-duplicate by MBID when merging.

### Field mapping notes

- `media[]` is per physical disc. A 2-CD set has two entries; `discCount` is the
  length of that array, and the format lives on each medium, not the release.
- `label-info[]` carries both the label name and `catalog-number` — the code
  printed on the spine. Multiple entries are common; keep them all.
- `country` may be `XW`, meaning worldwide, which usually indicates a digital
  release rather than a pressing from a specific territory.
- Dates are partial: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Never parse one with
  `new Date()` and assume a full timestamp; use `releaseYear()`.
- `artist-credit[]` models collaborations with join phrases. Flatten it for
  display, but keep the individual names for filtering.

## Cover Art Archive

Base: `https://coverartarchive.org`. No key, CORS open on every hop.

- `/release/{mbid}` → JSON index of available images with `types` (Front, Back, …)
  and thumbnails at 250, 500 and 1200 px.
- `/release/{mbid}/front-500` → redirects to the image.

Both `404` legitimately when a release has no art; that is an expected outcome, not
an error to surface as a failure.

Requests redirect (307) to `archive.org`, which can be slow and occasionally
unavailable. **Never hotlink these URLs from the UI.** At ingest, fetch the image,
resize it to the sizes the UI needs, store it in Blob, and reference our own URL.
The shelf must not depend on the Internet Archive's latency.

## Blob storage

The operation budget is small and exceeding it locks the store for 30 days. Rules:

- **Never `list()` at runtime.** `collection/index.json` is the authoritative
  listing; `list()` is an advanced operation and exists for maintenance scripts
  only.
- Writes are advanced operations. One user action should produce a bounded,
  predictable number of writes. Never write on a keystroke or a scroll.
- Read through the CDN with long cache lifetimes. Cache hits are free; misses are
  not.
- `del()` is free, so cleaning up after a failed ingest costs nothing — do it.

Index and detail documents must be written such that a failure cannot leave the
index referencing a disc document that was never written: write the disc document
first, then update the index.

## Discogs (not yet in use)

Reserved for phase-2 enrichment of pressing details. Requires a token; 60
requests/minute authenticated. Its terms restrict image use and images require
authentication, so **never** take artwork from Discogs — the Cover Art Archive is
the image source. Keep it strictly optional: if `DISCOGS_TOKEN` is unset,
everything must still work.

## Error handling for all of the above

These are free, community-run services that will sometimes be slow or down. A
failed metadata lookup must degrade to manual entry, never to a dead end. A failed
cover art fetch must still produce a saved disc, with a placeholder image.
Distinguish "not found" from "service unavailable" in what you show the user,
because the correct next action differs.
