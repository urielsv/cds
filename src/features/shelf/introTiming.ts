/**
 * A loading screen is only worth showing for a load that is actually long.
 * One that flashes up for half a second and vanishes is worse than none, so
 * the curtain starts blank — a plain page, like any page that has not drawn
 * yet — and only reveals its content once the first screen of covers looks
 * set to take longer than this in total.
 */
export const SHOW_IF_LONGER_THAN_MS = 3000;

/**
 * How long the curtain watches the covers arrive before predicting how long
 * the rest will take. Too short and one slow first response decides; this is
 * a few round trips on a phone.
 */
const PREDICT_AFTER_MS = 500;

/** How often the prediction is re-checked while the curtain is blank. */
export const PREDICT_EVERY_MS = 150;

/**
 * Whether a load that has painted `settled` of `total` covers in `elapsedMs`
 * is on course to take longer than `limitMs`, assuming covers keep arriving at
 * the rate they have so far. Nothing painted yet, past the watching period,
 * counts as long: the network is evidently slow.
 */
export function looksLong(
  settled: number,
  total: number,
  elapsedMs: number,
  limitMs = SHOW_IF_LONGER_THAN_MS,
): boolean {
  if (elapsedMs >= limitMs) return true;
  if (elapsedMs < PREDICT_AFTER_MS) return false;
  if (total > 0 && settled >= total) return false;
  if (settled === 0) return true;
  return (elapsedMs * total) / settled > limitMs;
}
