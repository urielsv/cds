import { getMusicBrainz, sessionSecret } from '../_lib/env.js';
import { handleLookup } from '../_lib/lookup.js';

/** `GET /api/lookup/search?q=…` — text, barcode or pasted MBID → ranked candidates. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleLookup(request, 'auto', { secret: sessionSecret(), musicbrainz: getMusicBrainz });
  },
};
