/**
 * Server-only configuration. Nothing here may be imported from `src/`: every
 * value is a secret or server-side concern, and anything reachable from the
 * browser bundle is public.
 */

import { createMusicBrainzClient, type MusicBrainzClient } from './musicbrainz.js';
import { type CollectionStore, createBlobStore } from './store.js';

export function sessionSecret(): string | undefined {
  return process.env.SESSION_SECRET;
}

export function passwordHash(): string | undefined {
  return process.env.UPLOAD_PASSWORD_HASH;
}

let musicbrainz: MusicBrainzClient | null = null;

/**
 * One client per function instance, so its request queue and cache are shared
 * by every request the instance serves.
 */
export function getMusicBrainz(): MusicBrainzClient {
  const userAgent = process.env.MUSICBRAINZ_USER_AGENT;
  if (userAgent === undefined || !/\(.+\)/.test(userAgent)) {
    // MusicBrainz blocks clients without a contact address; failing loudly
    // here beats being silently throttled in production.
    throw new Error('MUSICBRAINZ_USER_AGENT must be set, e.g. "MyCDs/0.1.0 ( you@example.com )".');
  }
  musicbrainz ??= createMusicBrainzClient({ userAgent });
  return musicbrainz;
}

export function getStore(): CollectionStore {
  return createBlobStore();
}
