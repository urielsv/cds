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

function durationMs(name: DurationName): number {
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
 * The transition to use for a gesture release, where a little overshoot reads as
 * physical weight.
 */
export function releaseTransition(): Transition {
  return transition('base', 'springish');
}

/**
 * Collapses any transition to effectively instant, preserving the end state.
 *
 * Used when `useReducedMotion()` is true: we keep cross-fades but remove the
 * travel, rather than disabling animation and leaving elements to pop.
 */
export const REDUCED_TRANSITION: Transition = { duration: 0.001 };
