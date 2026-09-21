# Requirements — CD collection

## Purpose

Let one person browse their compact disc collection on a phone in a way that feels
like handling the physical objects, and add new discs to it by scanning a barcode.

## Users

A single owner. Browsing is public (shareable by link); adding and editing require
a passphrase. There are no accounts and no second user role.

---

## 1. Browsing the shelf

**1.1** The collection is presented as a continuous grid of disc tiles that the
user pans through by dragging or scrolling. There is no pagination and no "load
more" button.

**1.2** Each tile shows the front cover art, and the title and artist.

**1.3** The grid remains responsive while panning with at least 300 discs present,
on a mid-range phone. Specifically: no frame exceeding 16ms during a sustained pan
under 4x CPU throttling.

**1.4** The shelf is usable before cover art has loaded. Tiles occupy their final
size immediately and art fades in; no layout shift occurs when an image arrives.

**1.5** Tiles give feedback within 100ms of touch, before the gesture completes.

**1.6** The grid adapts to viewport width, from a 320px phone to a desktop browser.
Phone is the primary target.

**1.7** The user's position in the shelf survives opening and closing a disc. It
does not reset to the top.

## 2. Viewing a disc

**2.1** Tapping a tile opens a detail view that visually grows from that tile, so it
reads as the same object rather than a new page.

**2.2** The detail view shows: front cover (and back, when available), title,
artist, release date, country of release, label(s), catalogue number, barcode,
physical format, packaging, disc count, genres, and the full track listing with
track durations and total runtime.

**2.3** Fields that MusicBrainz has no data for are omitted rather than shown empty.

**2.4** The track listing is readable without horizontal scrolling on a 320px
viewport, including long track titles.

**2.5** Personal notes entered by the owner are displayed if present.

**2.6** Closing the detail view returns to the shelf at the same scroll position,
with the animation reversing into the originating tile.

**2.7** Each disc has its own URL, so a specific disc can be linked to and opened
directly. Opening that URL cold renders the detail view without first rendering the
shelf.

**2.8** Browser back and forward navigate between shelf and disc correctly,
including after a direct deep link.

## 3. Search, filter, sort

**3.1** A text search matches against disc title, artist, and track titles.

**3.2** Search is fuzzy: minor misspellings and partial words still match. Searching
"dicovery" finds "Discovery".

**3.3** Search results update as the user types, without a submit action, and
without a network request.

**3.4** Diacritics are ignored in both directions: "sigur ros" matches "Sigur Rós"
and vice versa.

**3.5** The collection can be filtered by genre, decade or year, label, country, and
physical format. Filters combine.

**3.6** The collection can be sorted by artist, title, release date, and date added,
ascending or descending.

**3.7** The active search, filters and sort are reflected in the URL so a filtered
view can be shared or bookmarked.

**3.8** When a filter or search produces no results, the user is told so and offered
a way to clear it.

**3.9** Tiles animate between positions when the sort or filter changes, rather than
jumping, so the user can see what moved.

## 4. Adding a disc

**4.1** The add flow is reachable only after entering the correct passphrase.

**4.2** The user can scan a barcode with the rear camera and have the disc
identified from it.

**4.3** Because a barcode identifies a product line rather than a specific pressing,
the app presents the matching releases and the user confirms which one they are
holding. Candidates are ranked with physical CDs above digital releases. A single
result is still shown for confirmation and never auto-accepted.

**4.4** Each candidate is shown with enough information to tell pressings apart:
cover thumbnail, year, country, label, catalogue number, format and track count.

**4.5** The user can instead search by artist or title, with autocompleting
suggestions, and pick from the results.

**4.6** The user can instead enter a barcode by typing it.

**4.7** The user can instead decode a barcode from a still photo.

**4.8** If the camera permission is denied or unavailable, the user is told what
happened and moved directly to manual entry. The flow never dead-ends.

**4.9** Before saving, the user sees exactly what will be saved and can correct any
field, and can add personal notes.

**4.10** The user can photograph the actual disc and case, and those photos are
saved with the record.

**4.11** Cover art is copied into the project's own storage at save time. The live
site never depends on a third-party image host at render time.

**4.12** After saving, the new disc appears in the shelf without a full page reload.

**4.13** Adding a disc that is already in the collection is detected and the user is
warned before a duplicate is created.

**4.14** A save that fails partway leaves no partial record visible in the
collection.

## 5. Editing and removing

**5.1** The owner can edit any field of an existing disc, and can re-sync its
metadata from MusicBrainz.

**5.2** The owner can delete a disc, with a confirmation step.

## 6. Access control

**6.1** Browsing requires no authentication.

**6.2** Every operation that writes requires a valid session, verified on the
server. Hiding the UI is not sufficient.

**6.3** The passphrase is verified against a hash held in an environment variable.
The plaintext is never stored, logged, or sent anywhere except the login request.

**6.4** A successful login yields a short-lived, signed, HttpOnly cookie.

**6.5** Login attempts are rate-limited to make brute force impractical.

**6.6** The owner can log out, invalidating the session.

## 7. Motion and accessibility

**7.1** All animation uses the shared duration and easing tokens. No component
defines its own timing.

**7.2** When `prefers-reduced-motion` is set, the app presents a still version that
loses no information and no functionality.

**7.3** Everything operable by touch is operable by keyboard, with a visible focus
indicator at all times.

**7.4** Opening a disc moves focus into the detail view; closing returns focus to
the tile that was opened.

**7.5** All images have meaningful alternative text; cover art is described by disc
title and artist.

**7.6** No state change is communicated by animation alone.

**7.7** Colour contrast meets WCAG AA.

## 8. Operating constraints

**8.1** The whole app runs within the free tiers of its hosting and storage. Read
traffic must not consume metered storage operations, and no code path may call a
storage listing operation at runtime.

**8.2** MusicBrainz is reached only from the server side, with a descriptive
User-Agent, serialised to respect roughly one request per second.

**8.3** A MusicBrainz or Cover Art Archive outage degrades the add flow to manual
entry and never breaks browsing.

**8.4** Browsing an already-loaded collection makes no further network requests for
search, filter or sort.

## Out of scope

Audio playback. Multiple users, accounts or permissions. Price or valuation
tracking. Contributing edits back to MusicBrainz. Formats other than CD as
first-class citizens. Offline write support.

## Acceptance

The feature is done when: a disc can be added by scanning its barcode on a phone
and appears on the shelf; the shelf pans at 60fps with 300 discs under 4x CPU
throttle; a disc's URL can be shared and opens directly; search, filter and sort
work with no network traffic; the reduced-motion version is complete; and the whole
thing runs on free tiers.
