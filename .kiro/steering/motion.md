---
inclusion: fileMatch
fileMatchPattern: '{src/motion/**,src/features/**,src/components/**,src/styles/**,**/*.css}'
---

# Animation rules

The product's entire premise is that the interface feels like a physical object.
These rules exist so that separately-built pieces still feel like one object.

## Import from `motion/react`

```ts
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
```

Not `framer-motion` — the package was renamed. The old name still resolves on npm
and will quietly install a second animation runtime alongside this one.

## Animate only compositor properties

`transform`, `opacity`, `filter`, `clip-path`. Nothing else, ever, in a gesture or
transition the user is watching.

Animating `width`, `height`, `top`, `left`, `margin`, or `padding` forces layout on
every frame and will drop frames on a phone. If a size needs to change, animate
`scale`, or use Motion's `layout` prop, which converts a layout change into a
transform internally.

`box-shadow` is a special case: it is paint-bound and expensive to animate.
Cross-fade between two stacked elements with different static shadows instead, or
animate a pseudo-element's `opacity`.

## Draw timing from the tokens

Durations and easings come from the custom properties in `src/styles/global.css`
(`--duration-*`, `--ease-*`). Never hard-code a millisecond value or a bezier in a
component. If a new animation genuinely needs timing the scale does not offer, add
a token and say why in a comment — do not inline it.

For JavaScript-driven animation, read the tokens through the helpers in
`src/motion/` rather than duplicating the numbers in TypeScript.

Rough guide: `--duration-instant` for touch feedback, `--duration-fast` for small
state changes, `--duration-base` for most transitions, `--duration-slow` for
entering and leaving, `--duration-deliberate` reserved for the case-opening and
disc-flip moments that are meant to be noticed.

## Shared element transitions

Opening a disc must visually grow from the tile that was tapped. Use a matching
`layoutId` on the tile and the detail view. This is the single most important
animation in the app — it is what connects the grid to the object.

Wrap route-level transitions in `AnimatePresence` with `mode="popLayout"` or
`mode="wait"` as appropriate, and keep the `layoutId` values derived from the disc
id so they are stable across renders.

## Gestures should track the finger

Anything draggable follows the finger 1:1 with no easing while the gesture is
active; easing applies only to the release. A lag between finger and object breaks
the illusion of a physical thing more than any other mistake.

Use `--ease-spring-ish` for release animations on direct-manipulation elements, and
`--ease-standard` for everything the user is not touching.

## Respect reduced motion, but do not gut the product

CSS is handled globally: the `prefers-reduced-motion` block in `global.css`
collapses every duration token to ~1ms.

JavaScript-driven motion cannot see that, so any component animating through
Motion's imperative API must check `useReducedMotion()` and:

- keep cross-fades and colour changes,
- drop large translations, parallax, scale-from-zero, rotation and auto-playing
  loops,
- still reach the same end state.

A reduced-motion user must never lose access to information or be left staring at
an element that never arrives.

## Performance rules for the shelf

The shelf may hold hundreds of tiles. Therefore:

- Virtualise. Only mount what is near the viewport.
- `will-change` goes on at gesture start and comes **off** at gesture end. Leaving
  it on permanently costs memory per tile and will make things slower, not faster.
- Never animate a property on hundreds of elements simultaneously. Animate a single
  transformed container instead.
- Stagger entrance animations with a cap: a fixed small delay per item up to a
  limit, never `index * delay` unbounded, or the last tile arrives seconds late.
- Cover art fades in from a placeholder. Images must have intrinsic dimensions set
  so nothing reflows on load.

## Accessibility is not negotiable

- Every interactive element is a real `<button>` or `<a>`, animated via a wrapper.
  Never attach a click handler to a `motion.div` that should be a button.
- Focus must be visible at all times and must not be animated away. The focus ring
  in `global.css` is deliberate; do not remove the outline.
- Opening a disc moves focus into the detail view; closing it returns focus to the
  originating tile.
- An animation must never be the only indicator of a state change. Pair it with
  text or an ARIA live region.
