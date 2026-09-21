---
name: add-disc-ingest
description: Use when adding, re-syncing or backfilling a compact disc record in MyCDs — anything that fetches MusicBrainz metadata, pulls Cover Art Archive images, mirrors artwork into Blob storage, or writes the collection index. Covers the barcode and name-search lookup paths, candidate disambiguation, the exact write ordering that keeps the index consistent, and the free-tier operation budget.
---

# Ingesting a disc

The full path from "a barcode was scanned" to "the disc is on the shelf". Getting
the order wrong here produces an index that references documents that do not
exist, so follow it.

## 1. Resolve the barcode or query to candidates

Take the raw scanner output through `normaliseBarcode()`, then
`barcodeSearchVariants()`, and query MusicBrainz for each variant through the
`api/` proxy — never from the browser, because MusicBrainz needs a `User-Agent`
the browser cannot set. Serialise the requests; their limit is about one per
second.

Merge the results and de-duplicate by MBID.

For a name search, query the release search endpoint with the user's text and
apply the same ranking.

## 2. Always let the user choose

Rank with `rankCandidates()` from `shared/musicbrainz.ts`, which weights physical
CD media heavily above digital issues. Then **show the candidates**, with cover
thumbnail, year, country, label, catalogue number and track count, and have the
user confirm.

Do not auto-accept, not even a single result. A barcode identifies a product line,
not a pressing: `724384960650` returns two releases and neither is the CD. Silently
picking one is how the collection fills up with the wrong editions.

## 3. Fetch the full release once

```
/ws/2/release/{mbid}?fmt=json&inc=recordings+artist-credits+labels+release-groups+media+discids+genres
```

One request returns the tracklist with durations, labels with catalogue numbers,
packaging, per-medium format and genres. Parse it into a `Disc` with the schema in
`shared/disc.ts`. Map explicitly — do not store the raw MusicBrainz JSON and reach
into it later.

Remember `media[]` is per physical disc: a double album has two entries, and
`format` lives on the medium rather than the release.

## 4. Mirror the artwork; never hotlink it

Ask the Cover Art Archive for `/release/{mbid}`, take the front image (and back, if
present), and for each one:

1. Fetch the largest reasonable thumbnail (500 px is usually right for a tile;
   1200 px for the detail view).
2. Resize to the sizes the UI actually renders. Do this at ingest — once — so no
   request-time image transformation is ever needed.
3. Generate the tiny base64 placeholder for the fade-in.
4. `put()` each into Blob storage.

A `404` means the release has no art. That is normal; carry on with a placeholder
and a disc that is still fully valid.

If the user photographed the physical disc, downscale it **in the browser** with a
canvas before uploading. The phone should do that work, not a serverless function,
and it keeps the upload small on cellular.

## 5. Write in the order that cannot corrupt the index

1. Write `collection/discs/<id>.json` (the full record).
2. Write the image blobs.
3. **Last**, update `collection/index.json` to include the new summary.

The index is what the app reads, so it must only ever point at things that already
exist. If a step fails partway, `del()` whatever was written — deletes are free —
and leave the index untouched.

Read the current index, mutate it in memory, write it back once. Never read it
twice in one operation, and never write it per-field.

## 6. Stay inside the operation budget

Blob's Hobby tier allows 2,000 advanced operations (writes) a month, and going over
locks the store for 30 days with no way to pay your way out. One disc should cost a
small, countable number of writes: the disc document, its images, and one index
update.

Never call `list()`. The index is the listing.

## Checklist

- [ ] Lookups went through `api/`, not the browser
- [ ] Requests serialised, rate-limit headers respected
- [ ] User confirmed the pressing from ranked candidates
- [ ] Response validated with the Zod schema, mapped explicitly
- [ ] Artwork copied into Blob, not hotlinked; placeholder generated
- [ ] User photos downscaled client-side
- [ ] Disc document written before the index
- [ ] Partial failure cleaned up with `del()`
- [ ] No `list()` call anywhere
