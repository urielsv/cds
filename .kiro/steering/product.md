# What MyCDs is

A single-user, mobile-first web app for browsing a personal compact disc
collection. It is a UI/UX project before it is a data project: the goal is that
moving through the collection on a phone feels like handling the physical discs.

## The two flows, and their relative weight

1. **Visualise (primary).** Browse a continuous, pannable shelf of discs. Open one
   to see cover art, pressing details and the track listing. Search, filter and
   sort. This flow gets the overwhelming majority of the design and performance
   budget.
2. **Add a disc (secondary).** Scan a barcode or search by name, confirm which
   pressing it is, optionally photograph the actual disc, save. Used a handful of
   times per session at most, by one person, standing in front of a shelf.

When the two flows conflict, the browse experience wins. It is acceptable for the
upload flow to take an extra network round trip or an extra tap; it is not
acceptable for the shelf to drop frames.

## Who uses it

One person — the collection's owner. Browsing is public so it can be shared with
a link, but there are no accounts, no social features, no multi-user concerns, and
no expectation of concurrent writes. Do not introduce user management,
collaborative editing, or per-user state. If a feature only makes sense with
multiple users, it is out of scope.

## What "feels alive" means here

The animation is functional, not decorative. Every motion should answer one of:

- **Where did this come from?** A disc that opens grows out of the tile the user
  tapped, so the detail view is understood as the same object, not a new page.
- **What can I do with this?** Tiles respond to touch before the gesture
  completes — a slight lift, a parallax shift of the cover under the finger.
- **What just changed?** New discs settle into the shelf rather than appearing.

Motion that answers none of these is decoration and should be cut. A spinning
disc that spins because spinning looks nice is worse than no animation, because it
costs frames and attention.

## Deliberately out of scope

- Audio playback. This catalogues objects; it is not a music player.
- Multi-user accounts, sharing permissions, or collaborative libraries.
- Marketplace or valuation features. Not a shop, not a price tracker.
- Vinyl, cassettes, and other formats as first-class citizens. The data model
  records the format because MusicBrainz provides it, and the model would not
  fight an expansion later, but the product is about CDs.
- Editing MusicBrainz itself. We consume that database; we do not contribute
  back from this app.

## Quality bar

The reference is a well-built product marketing page: deliberate, smooth,
physical, and fast on a mid-range phone over cellular. Concretely:

- Interaction feedback within ~100ms of touch.
- No dropped frames while panning the shelf, including on a throttled CPU.
- The shelf is usable before all cover art has loaded.
- Everything reachable by touch is reachable by keyboard and screen reader.
- `prefers-reduced-motion` produces a calm, still version that is still complete.
