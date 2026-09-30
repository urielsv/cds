/**
 * Bridges the CSS motion tokens into TypeScript.
 *
 * `src/styles/global.css` is the single source of truth for durations and
 * easings. Rather than duplicating those numbers here — which would let the CSS
 * and JS drift, and would break the global `prefers-reduced-motion` override
 * that rewrites the CSS values — we read the custom properties once at startup.
 */

import type { Transition } from 'motion/react';

/** Fallbacks for when there is no DOM (tests) or the property is missing. */
const FALLBACK_DURATIONS_MS = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 380,
  deliberate: 560,
} as const;

const FALLBACK_EASINGS = {
  standard: [0.2, 0, 0.13, 1],
  entrance: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15],
  springish: [0.34, 1.56, 0.64, 1],
} as const;

export type DurationName = keyof typeof FALLBACK_DURATIONS_MS;
export type EasingName = keyof typeof FALLBACK_EASINGS;

type Cubic = [number, number, number, number];

function readCustomProperty(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw.length > 0 ? raw : null;
}

/** Parses a CSS time value (`240ms`, `0.24s`) into milliseconds. */
export function parseCssDuration(value: string): number | null {
  const match = /^([\d.]+)(ms|s)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  const amount = Number.parseFloat(match[1]);
  if (Number.isNaN(amount)) return null;
  return match[2] === 's' ? amount * 1000 : amount;
}

/** Parses `cubic-bezier(a, b, c, d)` into the four control points. */
export function parseCubicBezier(value: string): Cubic | null {
  const match = /^cubic-bezier\(([^)]+)\)$/.exec(value.trim());
  if (!match?.[1]) return null;
  const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  return parts as Cubic;
}

/** A duration token in milliseconds, for timers that must match a CSS transition. */
export function durationMs(name: DurationName): number {
  const raw = readCustomProperty(`--duration-${name}`);
  const parsed = raw === null ? null : parseCssDuration(raw);
  return parsed ?? FALLBACK_DURATIONS_MS[name];
}

function easing(name: EasingName): Cubic {
  // The CSS token for `springish` is spelled `--ease-spring-ish`.
  const cssName = name === 'springish' ? 'spring-ish' : name;
  const raw = readCustomProperty(`--ease-${cssName}`);
  const parsed = raw === null ? null : parseCubicBezier(raw);
  return parsed ?? (FALLBACK_EASINGS[name] as unknown as Cubic);
}

/**
 * Builds a Motion transition from the named tokens.
 *
 * Durations are in seconds for Motion, milliseconds in CSS.
 */
export function transition(duration: DurationName, ease: EasingName = 'standard'): Transition {
  return {
    duration: durationMs(duration) / 1000,
    ease: easing(ease),
  };
}

/**
 * Bounce for the release springs. Zero is critically damped: the wall arrives
 * without wobbling around its resting cell. The spring still carries the
 * finger's velocity, which is what makes a release feel physical — a hard
 * flick into an edge overshoots and comes back on its own, without any bounce
 * being added.
 */
const SPRING_BOUNCE = 0;

/**
 * A physical spring for direct-manipulation releases, timed by a duration
 * token and started at the finger's velocity (units per second).
 *
 * Unlike a tween, a spring begins moving at whatever speed the content already
 * had, so there is no visible change of pace at the instant the finger lifts —
 * the difference between a throw and a correction. `visualDuration` is the time
 * to visibly arrive, so the tokens keep their meaning.
 */
export function springTransition(duration: DurationName, velocity = 0): Transition {
  return {
    type: 'spring',
    visualDuration: durationMs(duration) / 1000,
    bounce: SPRING_BOUNCE,
    velocity,
  };
}

/**
 * Collapses any transition to effectively instant, preserving the end state.
 *
 * Used when `useReducedMotion()` is true: we keep cross-fades but remove the
 * travel, rather than disabling animation and leaving elements to pop.
 */
export const REDUCED_TRANSITION: Transition = { duration: 0.001 };
