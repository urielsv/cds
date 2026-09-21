---
name: shelf-performance
description: Use when building or debugging the browsable disc shelf — the pannable/zoomable grid, virtualisation, scroll and drag gestures, tile rendering, image loading, or any report that the collection feels janky, drops frames, stutters on a phone, or is slow with many discs. Also use before adding any animation that runs on many tiles at once.
---

# Keeping the shelf at 60fps

The shelf is the product. It may hold hundreds of tiles, each with cover art, and
it must pan smoothly on a mid-range phone. Everything below exists because the
naive implementation of each point is slow.

## Virtualise, and measure the window

Mount only the tiles near the viewport. `@tanstack/react-virtual` handles a 2D grid
by composing a row virtualiser and a column virtualiser.

Keep the overscan small but non-zero — enough that a fast flick does not reveal
empty space, small enough that you are not rendering a screenful of invisible
tiles. Tune it by measuring, not by guessing, and note the reasoning in a comment.

## Transform the container, not the tiles

Panning moves **one** transformed element. Never update the position of each tile
individually; that is hundreds of style recalculations per frame.

The same applies to animation: if every tile should react to something, animate the
container, or animate a single overlay. An animation that touches N elements per
frame is an animation that does not run at 60fps when N is large.

## Gestures track the finger exactly

While a drag is active, position follows the pointer 1:1 with no easing and no
spring. Easing belongs only to the release. Any perceptible lag between finger and
content destroys the physicality the product is built on.

Read pointer events, not scroll events, for the drag. Use `touch-action` to tell
the browser which axes you are handling so it stops fighting you, and remember the
page-level `overscroll-behavior: none` already set in `global.css` is what prevents
rubber-banding from hijacking a pan.

## `will-change` is a lease, not a gift

Add `will-change: transform` when a gesture starts; remove it when the gesture
ends. It promotes the element to its own compositor layer, which costs memory —
multiply that by hundreds of tiles and the browser starts evicting layers, making
everything slower than if you had never used it.

Never put `will-change` on a tile in static CSS.

## Images are the real cost

- Serve pre-resized artwork from Blob at roughly the rendered size. Never hand a
  1200 px cover to a 140 px tile.
- Set explicit `width` and `height` (or an `aspect-ratio`) so a loading image
  cannot reflow the grid.
- `loading="lazy"` and `decoding="async"` on off-screen covers.
- Fade in from the stored base64 placeholder. The shelf must be usable and
  navigable before any artwork has arrived.
- Cache-bust by URL, never by query string, so CDN hits stay free.

## Stagger with a ceiling

Entrance animations staggered by `index * delay` mean the two-hundredth tile
animates seconds after the first. Cap the stagger: compute the delay from the
item's position within the _visible_ window, and clamp the total.

## Text and layout

Filtering and sorting run on the whole in-memory collection. Keep that work off the
critical path of a gesture: debounce search input, and do the filtering in a
`useMemo` keyed on the query and filters rather than per render. For hundreds of
items Fuse.js is fast enough on the main thread; if the collection grows enough
that it is not, move it to a worker rather than making the shelf wait.

Avoid layout-triggering reads (`offsetWidth`, `getBoundingClientRect`) inside
animation frames or scroll handlers. Measure once, cache, invalidate on resize.

## How to actually verify it

Do not trust a desktop dev build. Check:

1. Chrome DevTools performance profile with **CPU throttled 4-6x**, panning
   continuously. Look for frames over 16ms and for layout/recalculate-style work,
   which should be near zero during a pan.
2. A real phone, over a throttled network, with a realistic collection size.
3. The layer count — one promoted layer per visible tile at most, and only during
   a gesture.

A profile showing `Recalculate Style` or `Layout` during a pan means something is
animating a non-compositor property. Find it and fix it rather than reducing the
animation's duration to hide it.

## Checklist

- [ ] Only near-viewport tiles are mounted
- [ ] Panning transforms a single container
- [ ] Drag tracks the pointer with no easing mid-gesture
- [ ] `will-change` added on gesture start, removed on end
- [ ] Images pre-sized, dimensioned, lazy, with placeholders
- [ ] Stagger is clamped
- [ ] Filtering memoised and debounced
- [ ] Profiled with throttled CPU; no layout work during a pan
