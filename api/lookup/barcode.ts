import { getMusicBrainz, sessionSecret } from '../_lib/env.js';
import { handleLookup } from '../_lib/lookup.js';

/** `GET /api/lookup/barcode?q=…` — barcode → ranked candidates, merged across variants. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleLookup(request, 'barcode', {
      secret: sessionSecret(),
      musicbrainz: getMusicBrainz,
    });
  },
};
