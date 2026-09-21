/**
 * A deterministic fake collection, for developing the shelf before any real data
 * exists.
 *
 * Deliberately generated rather than hand-written so the shelf can be tested at
 * 150 discs (the current real collection) and at 400 (the expected ceiling in
 * about three years) without maintaining a fixture file. Deterministic so that
 * performance profiles are comparable between runs.
 *
 * Cover art is a generated gradient data URI: no network, no licensing question,
 * and still enough visual variety to judge whether the grid reads well.
 */

import { type CollectionIndex, type DiscIndexEntry } from '@shared/disc';
import { discSlug } from '@shared/format';

const ARTISTS = [
  'Daft Punk',
  'Radiohead',
  'Sigur Rós',
  'Boards of Canada',
  'Massive Attack',
  'Portishead',
  'Aphex Twin',
  'Björk',
  'The Chemical Brothers',
  'Air',
  'Mogwai',
  'Godspeed You! Black Emperor',
  'Burial',
  'Four Tet',
  'Caribou',
  'Bonobo',
  'Thom Yorke',
  'Fever Ray',
  'The Knife',
  'Mötley Crüe',
  'Pink Floyd',
  'Talk Talk',
  'Cocteau Twins',
  'My Bloody Valentine',
  'Slowdive',
  'Ride',
  'Stereolab',
  'Broadcast',
  'Autechre',
  'Squarepusher',
  'Flying Lotus',
  'Shabazz Palaces',
  'Kendrick Lamar',
  'Madvillain',
  'J Dilla',
  'Gustavo Cerati',
  'Soda Stereo',
  'Los Fabulosos Cadillacs',
  'Babasónicos',
  'Spinetta',
];

const TITLE_WORDS_A = [
  'Discovery',
  'Kid',
  'Ágætis',
  'Geogaddi',
  'Mezzanine',
  'Dummy',
  'Selected Ambient',
  'Homogenic',
  'Surrender',
  'Moon Safari',
  'Young Team',
  'Lift Your Skinny',
  'Untrue',
  'Rounds',
  'Swim',
  'Black Sands',
  'Eraser',
  'Plunge',
  'Silent Shout',
  'Dr. Feelgood',
];

const TITLE_WORDS_B = [
  'Works',
  'Sessions',
  'Volume II',
  'Remixes',
  'Reissue',
  'Anniversary Edition',
  'Live',
  'Demos',
  'B-Sides',
  '',
];

const LABELS = [
  'Virgin',
  'Warp',
  'XL Recordings',
  'Ninja Tune',
  'Domino',
  '4AD',
  'Mute',
  'Parlophone',
  'Sub Pop',
  'Rough Trade',
  'Columbia',
  'Sony Music Argentina',
];

// Weighted toward AR so local pressings are well represented, matching the
// collector's preferred country used by the candidate ranker.
const COUNTRIES = ['AR', 'AR', 'AR', 'US', 'GB', 'DE', 'JP', 'FR', 'SE', 'BR', 'XW', null];

const FORMATS = ['CD', 'CD', 'CD', 'Enhanced CD', 'HDCD', 'CD + DVD'];

const GENRES = [
  'electronic',
  'house',
  'ambient',
  'trip hop',
  'shoegaze',
  'post-rock',
  'rock',
  'alternative rock',
  'hip hop',
  'experimental',
  'idm',
  'dream pop',
  'techno',
  'jazz',
  'rock nacional',
];

const TRACK_WORDS = [
  'One More Time',
  'Aerodynamic',
  'Digital Love',
  'Veridis Quo',
  'Nightcall',
  'Svefn-g-englar',
  'Glósóli',
  'Teardrop',
  'Angel',
  'Roads',
  'Glory Box',
  'Xtal',
  'Heliosphan',
  'Jóga',
  'Bachelorette',
  'Kelly Watch the Stars',
  'La Femme d’Argent',
  'Summer Madness',
  'Kiara',
  'Archangel',
  'Everything in Its Right Place',
  'Idioteque',
  'Reckoner',
  'Nude',
  'Weird Fishes',
  'Alisa',
  'Puente',
  'Crimen',
  'Cactus',
  'Té para Tres',
];

/**
 * A small deterministic PRNG (mulberry32). `Math.random()` would make profiles
 * and snapshots incomparable between runs.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  // Non-empty arrays only; every constant above satisfies that.
  return items[Math.floor(random() * items.length)] as T;
}

/**
 * Builds a cover as an SVG data URI: two-stop gradient plus a couple of bands, so
 * tiles are visually distinguishable while scrolling.
 */
function generateCover(random: () => number): string {
  const hue = Math.floor(random() * 360);
  const hue2 = (hue + 30 + Math.floor(random() * 90)) % 360;
  const light = 18 + Math.floor(random() * 22);
  const angle = Math.floor(random() * 180);
  const bandY = 20 + Math.floor(random() * 55);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
<defs><linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">
<stop offset="0" stop-color="hsl(${hue} 55% ${light}%)"/>
<stop offset="1" stop-color="hsl(${hue2} 45% ${light + 14}%)"/>
</linearGradient></defs>
<rect width="300" height="300" fill="url(#g)"/>
<rect x="0" y="${bandY}%" width="300" height="6" fill="hsl(${hue2} 70% 72%)" opacity="0.5"/>
<circle cx="${40 + random() * 220}" cy="${40 + random() * 220}" r="${18 + random() * 46}"
  fill="none" stroke="hsl(${hue} 80% 85%)" stroke-width="1.5" opacity="0.35"/>
</svg>`;

  // encodeURIComponent keeps this valid without base64 and stays readable in
  // devtools. No text is drawn: real covers are images, and lettering would make
  // the fixture look more finished than it is.
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n\s*/g, ' '))}`;
}

function generateDisc(index: number, random: () => number): DiscIndexEntry {
  const artist = pick(random, ARTISTS);
  const titleA = pick(random, TITLE_WORDS_A);
  const titleB = pick(random, TITLE_WORDS_B);
  const title = titleB === '' ? titleA : `${titleA} ${titleB}`;

  const year = 1985 + Math.floor(random() * 40);
  const month = 1 + Math.floor(random() * 12);
  // Mix full dates, year-month and year-only, as MusicBrainz really does.
  const precision = random();
  const releaseDate =
    precision < 0.6
      ? `${year}-${String(month).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`
      : precision < 0.85
        ? `${year}-${String(month).padStart(2, '0')}`
        : `${year}`;

  const genreCount = 1 + Math.floor(random() * 3);
  const genres = [...new Set(Array.from({ length: genreCount }, () => pick(random, GENRES)))];

  const trackCount = 8 + Math.floor(random() * 9);
  const trackTitles = Array.from({ length: trackCount }, () => pick(random, TRACK_WORDS));

  const labelCount = 1 + (random() < 0.25 ? 1 : 0);
  const labels = [...new Set(Array.from({ length: labelCount }, () => pick(random, LABELS)))];

  // `index` keeps ids unique even when artist, title and year collide.
  const id = `${discSlug(artist, title, releaseDate)}-${index}`;

  return {
    id,
    title,
    artist,
    releaseDate,
    country: pick(random, COUNTRIES),
    labels,
    format: pick(random, FORMATS),
    genres,
    addedAt: new Date(Date.UTC(2023, 0, 1) + index * 86_400_000 * 3).toISOString(),
    thumbnail: {
      url: generateCover(random),
      width: 300,
      height: 300,
      placeholder: null,
      kind: 'front',
    },
    trackTitles,
  };
}

/** Builds a deterministic collection index of `count` discs. */
export function generateFixtureCollection(count = 150, seed = 20260921): CollectionIndex {
  const random = createRandom(seed);
  return {
    version: 1,
    generatedAt: new Date(Date.UTC(2026, 8, 21)).toISOString(),
    discs: Array.from({ length: count }, (_, i) => generateDisc(i, random)),
  };
}
