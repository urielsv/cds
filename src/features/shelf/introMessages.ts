/**
 * What the loading screen says while the first covers arrive. A person
 * standing at a shelf, not a progress dialog: short, a little wry, and never
 * a claim about what is actually happening on the network.
 */
export const INTRO_MESSAGES = [
  'Loading the best albums…',
  'Dusting off the jewel cases…',
  'Flipping through the crates…',
  'Warming up the laser…',
  'Checking for scratches…',
  'Finding the liner notes…',
  'Blowing on the discs. It never helps.',
  'Alphabetising, then un-alphabetising…',
  'Untangling the headphone cable…',
  'Skipping the hidden track…',
  'Peeling the sticker off the case…',
  'The good ones are always at the back…',
] as const;

/** Shown for the instant between the last cover arriving and the reveal. */
export const INTRO_DONE_MESSAGE = 'Here’s the collection.';

/**
 * The messages in a fresh order for this visit, so a returning visitor does
 * not read the same three lines every time. The first line is always the
 * plainest one — it is the only one most fast loads ever show, and it should
 * say what is going on.
 */
export function introSequence(random: () => number = Math.random): string[] {
  const [first, ...rest] = INTRO_MESSAGES;
  const shuffled = [...rest];
  // Fisher–Yates.
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined) continue;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return [first, ...shuffled];
}
