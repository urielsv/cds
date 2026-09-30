#!/usr/bin/env node
/**
 * Builds the demo collection: real albums, real metadata, real cover art.
 *
 *   node scripts/seed-demo.mjs            # all of scripts/demo-albums.txt
 *   node scripts/seed-demo.mjs --limit 20 # a quick partial run
 *
 * For each "Artist — Album" line it finds the release group on MusicBrainz,
 * picks the earliest CD pressing that has front cover art, fetches that
 * release in full, and maps it with the same `shared/` code the real ingest
 * uses. The result is `src/dev/demoCollection.json`, which the app shows when no
 * real collection is configured.
 *
 * Ratings in the demo are synthetic — see `demoRating` — because they are the
 * owner's own judgement and nobody has rated these. They exist so the
 * arrange-by-rating wall has something to shape.
 *
 * Metadata is MusicBrainz's CC0 core data, so the JSON may be committed. The
 * artwork is NOT copied into the repo: each cover is referenced at the Cover Art
 * Archive, because the images belong to their owners and this repository is
 * public. That hotlink is the one deliberate exception to "never hotlink CAA",
 * and it only ever applies to the demo — see `src/lib/collection.ts`.
 *
 * About three MusicBrainz requests per album at their one-per-second limit, so
 * a full run takes ten minutes or so. Responses are cached under
 * `node_modules/.cache/seed-demo`, so a re-run is fast and polite.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'node_modules/.cache/seed-demo');
const listPath = join(root, 'scripts/demo-albums.txt');
const outPath = join(root, 'src/dev/demoCollection.json');

const USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT ?? 'MyCDs-demo-seed/0.1.0 ( https://github.com/urielsv/cds )';
const MIN_INTERVAL_MS = 1100;

const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex > 0 ? Number(process.argv[limitIndex + 1]) : Infinity;

// The shared mapping is TypeScript with `.js` import specifiers; Vite's SSR
// loader resolves those exactly as the app build does, so the demo is mapped
// by the very code that maps real discs.
const { createServer } = await import('vite');
const vite = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
const { mbReleaseSchema, mapRelease, hasCdMedium } =
  await vite.ssrLoadModule('/shared/musicbrainz.ts');
const { toIndexEntry, uniqueDiscId } = await vite.ssrLoadModule('/shared/collection.ts');
const { collectionIndexSchema } = await vite.ssrLoadModule('/shared/disc.ts');
const { discSlug } = await vite.ssrLoadModule('/shared/format.ts');

mkdirSync(cacheDir, { recursive: true });

let nextAllowedAt = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cached, serialised, rate-limited GET against the MusicBrainz API. */
async function musicbrainz(path) {
  const file = join(cacheDir, `${createHash('sha1').update(path).digest('hex')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });
    nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
    if (response.status === 503 || response.status === 429) {
      // Their "slow down": back off harder each time rather than hammering.
      nextAllowedAt = Date.now() + MIN_INTERVAL_MS * (attempt + 2) * 2;
      continue;
    }
    if (!response.ok) throw new Error(`MusicBrainz ${response.status} for ${path}`);
    const body = await response.json();
    writeFileSync(file, JSON.stringify(body));
    return body;
  }
  throw new Error(`MusicBrainz kept refusing ${path}`);
}

const lucene = (text) => `"${text.replace(/["\\]/g, ' ')}"`;

/**
 * Average colour of a cover, for "arrange by colour" and the tile's tint while
 * it loads. Uses macOS's built-in `sips` to shrink the image to one pixel, so
 * the script needs no image library; elsewhere the colour is simply left out.
 */
async function averageColour(url) {
  // Cached: a re-run should not re-download 200 covers, and a colour that was
  // computed once should never silently change.
  const cacheFile = join(
    cacheDir,
    `${createHash('sha1').update(`colour:${url}`).digest('hex')}.txt`,
  );
  if (existsSync(cacheFile)) {
    const cached = readFileSync(cacheFile, 'utf8').trim();
    return cached.length > 0 ? cached : null;
  }

  // The Cover Art Archive redirects to archive.org, which intermittently 500s;
  // a cover is worth a couple of retries before giving up on its colour.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = join(tmpdir(), `mycds-seed-${process.pid}.img`);
      const pixel = join(tmpdir(), `mycds-seed-${process.pid}.bmp`);
      writeFileSync(source, Buffer.from(await response.arrayBuffer()));
      execFileSync('sips', ['-s', 'format', 'bmp', '-z', '1', '1', source, '--out', pixel], {
        stdio: 'ignore',
      });
      const bmp = readFileSync(pixel);
      rmSync(source, { force: true });
      rmSync(pixel, { force: true });
      const offset = bmp.readUInt32LE(10);
      const [b, g, r] = [bmp[offset], bmp[offset + 1], bmp[offset + 2]];
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      writeFileSync(cacheFile, hex);
      return hex;
    } catch {
      await sleep(600 * (attempt + 1));
    }
  }
  console.log('    (no colour for this cover)');
  return null;
}

/**
 * A stable pseudo-rating for the demo, derived from the disc id so it never
 * changes between runs. Weighted to look like a real collection: a handful of
 * favourites, most albums unrated.
 */
function demoRating(id) {
  const hash = createHash('sha1').update(id).digest();
  const bucket = hash[0] % 100;
  if (bucket < 8) return 5;
  if (bucket < 22) return 4;
  if (bucket < 34) return 3;
  if (bucket < 40) return 2;
  if (bucket < 43) return 1;
  return null;
}

function parseList() {
  return readFileSync(listPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [artist, album] = line.split(/\s+—\s+/);
      return { artist, album, line };
    })
    .filter((entry) => entry.artist && entry.album);
}

const fold = (text) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

async function findReleaseGroup({ artist, album }) {
  const query = `releasegroup:${lucene(album)} AND artist:${lucene(artist)}`;
  const body = await musicbrainz(
    `release-group?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
  );
  const groups = body['release-groups'] ?? [];
  // Search relevance happily ranks "Selections from Play" or a deluxe
  // instrumental edition above the album itself, so prefer an exact title on a
  // plain studio album before trusting the score.
  const isPlainAlbum = (g) =>
    g['primary-type'] === 'Album' && (g['secondary-types'] ?? []).length === 0;
  return (
    groups.find((g) => isPlainAlbum(g) && fold(g.title) === fold(album)) ??
    groups.find((g) => fold(g.title) === fold(album)) ??
    groups.find((g) => isPlainAlbum(g) && (g.score ?? 0) >= 90) ??
    null
  );
}

/** The earliest CD pressing with front art: the closest thing to "the" album. */
async function pickRelease(groupId) {
  // Classic albums have hundreds of releases; page through a few hundred so
  // the CD pressings are not all beyond the first page.
  const releases = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const body = await musicbrainz(
      `release?release-group=${groupId}&inc=media+labels+artist-credits&fmt=json&limit=100&offset=${offset}`,
    );
    releases.push(...(body.releases ?? []));
    if (releases.length >= (body['release-count'] ?? 0)) break;
  }
  const candidates = releases
    .filter((release) => release['cover-art-archive']?.front === true)
    .filter((release) => hasCdMedium({ formats: (release.media ?? []).map((m) => m.format ?? '') }))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return candidates[0] ?? null;
}

const albums = parseList().slice(0, limit);
const entries = [];
const skipped = [];
const taken = new Set();
const now = Date.now();

for (const [i, album] of albums.entries()) {
  const label = `[${String(i + 1).padStart(3)}/${albums.length}] ${album.line}`;
  try {
    const group = await findReleaseGroup(album);
    if (!group) throw new Error('no matching release group');
    const chosen = await pickRelease(group.id);
    if (!chosen) throw new Error('no CD pressing with cover art');

    const full = mbReleaseSchema.parse(
      await musicbrainz(
        `release/${chosen.id}?fmt=json&inc=recordings+artist-credits+labels+release-groups+media+genres`,
      ),
    );
    // Spread "date added" over the past few years so "recently added" has a
    // meaningful order, newest first matching the file's order.
    const addedAt = new Date(now - i * 5 * 86_400_000).toISOString();
    const draft = mapRelease(full, { id: 'pending', now: addedAt });
    const id = uniqueDiscId(
      discSlug(draft.artist, draft.title, draft.releaseDate),
      taken,
      chosen.id,
    );
    taken.add(id);

    const tileUrl = `https://coverartarchive.org/release/${chosen.id}/front-250`;
    const disc = {
      ...draft,
      id,
      images: [{ url: tileUrl, width: 250, height: 250, placeholder: null, kind: 'front' }],
    };
    const color = await averageColour(tileUrl);
    entries.push({ ...toIndexEntry(disc, color), rating: demoRating(id) });
    console.log(
      `${label}  →  ${draft.releaseDate ?? '????'} ${draft.country ?? '--'} ${color ?? ''}`,
    );
  } catch (error) {
    skipped.push(`${album.line} (${error.message})`);
    console.log(`${label}  ✗ ${error.message}`);
  }
}

const index = collectionIndexSchema.parse({
  version: 1,
  generatedAt: new Date().toISOString(),
  discs: entries,
});
writeFileSync(outPath, `${JSON.stringify(index, null, 1)}\n`);
await vite.close();

console.log(`\nWrote ${entries.length} albums to ${outPath}`);
if (skipped.length > 0) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
