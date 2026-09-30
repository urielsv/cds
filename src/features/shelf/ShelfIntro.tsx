import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { durationMs, REDUCED_TRANSITION, transition } from '@/motion/tokens';

import { coverLoader } from '@/lib/coverLoader';
import { INTRO_DONE_MESSAGE, introSequence } from './introMessages';

/**
 * The longest the intro will ever hold the wall back. It waits for every cover
 * on the first screen to be painted, because a curtain that lifts onto blank
 * tiles has not done its job; this bound is what keeps it honest to the rule
 * that the shelf is usable before its artwork has loaded. The skip button and
 * a touch lift it sooner.
 */
const INTRO_MAX_MS = 10_000;

/** When the explicit "show what's here" control appears. */
const SKIP_AFTER_MS = 1500;

/**
 * How long each message stays up: reading time for a short line, not an
 * animation duration. The change between messages uses the motion tokens.
 */
const MESSAGE_MS = 1300;

/** How far the disc is out of its case before anything has loaded (0–1). */
const DISC_PEEK = 0.1;

/**
 * Geometry of the slide, as fractions of the disc's and the pair's own width:
 * fully out, the disc has travelled 67% of its width (clear of the case but
 * still overlapping it), and the pair has shifted 30% left to stay centred.
 */
const DISC_TRAVEL = 0.674;
const GROUP_SHIFT = 0.3;

/**
 * A hint of overshoot as the disc clears the case: the sense of a pushed
 * object with mass. Any more and it reads as a toy.
 */
const DISC_BOUNCE = 0.18;

type Phase = 'showing' | 'leaving' | 'gone';

/**
 * A short loading screen over the wall until the first screen of covers is in.
 *
 * Without it the first thing anyone sees is a grid of empty colour blocks
 * filling in one at a time. With it, the wall appears once, mostly complete.
 *
 * It is a curtain, not a gate: a touch, a key, the "show what's here" button,
 * or the time limit lifts it at once, and the wall underneath is live
 * throughout.
 *
 * `urls` is the first screen's artwork, or null while the wall is measuring.
 */
export function ShelfIntro({ urls }: { urls: readonly string[] | null }) {
  const reduced = useReducedMotion() ?? false;
  const [messages] = useState(() => introSequence());
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState({ skip: false, timedOut: false });
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>('showing');

  const subscribe = useCallback((listener: () => void) => coverLoader.subscribe(listener), []);
  const settled = useSyncExternalStore(subscribe, () =>
    urls === null
      ? 0
      : urls.reduce((count, url) => count + (coverLoader.isOnScreen(url) ? 1 : 0), 0),
  );
  const total = urls?.length ?? 0;
  // Every cover on the first screen painted (or given up on): only then.
  const complete = urls !== null && settled >= total;
  const ready = dismissed || elapsed.timedOut || complete;

  useEffect(() => {
    const timers = [
      window.setTimeout(() => {
        setElapsed((e) => ({ ...e, skip: true }));
      }, SKIP_AFTER_MS),
      window.setTimeout(() => {
        setElapsed((e) => ({ ...e, timedOut: true }));
      }, INTRO_MAX_MS),
    ];
    const rotate = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % messages.length);
    }, MESSAGE_MS);
    // Any key but Tab lifts the curtain; Tab reaches the button inside it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && event.key !== 'Shift') setDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.clearInterval(rotate);
      window.removeEventListener('keydown', onKey);
    };
  }, [messages.length]);

  // Fade, then unmount, so nothing sits over the wall once it is shown.
  useEffect(() => {
    if (!ready) return;
    const leave = window.requestAnimationFrame(() => {
      setPhase('leaving');
    });
    const gone = window.setTimeout(() => {
      setPhase('gone');
    }, durationMs('slow'));
    return () => {
      window.cancelAnimationFrame(leave);
      window.clearTimeout(gone);
    };
  }, [ready]);

  const progress = total === 0 ? 1 : Math.min(1, settled / total);
  // The disc starts just peeking out of its case, so there is something to
  // see before the first cover lands, and is all the way out when done.
  const slide = ready ? 1 : DISC_PEEK + (1 - DISC_PEEK) * progress;

  /**
   * The disc's travel is a spring chasing the progress, not a transition to
   * it. Covers arrive one at a time, so progress moves in small steps; a
   * transition restarts from standstill at every step and the disc stutters
   * out of the case. A spring is re-aimed at each step and keeps the speed it
   * already has, so the disc glides, eases into its final position, and
   * overshoots a hair when it clears the case — the way a disc that has been
   * pushed actually moves. `deliberate` because this is the case opening.
   */
  const travel = useSpring(slide, {
    visualDuration: durationMs('deliberate') / 1000,
    bounce: DISC_BOUNCE,
  });
  useEffect(() => {
    if (reduced) travel.jump(slide);
    else travel.set(slide);
  }, [reduced, slide, travel]);

  // Everything else is derived from that one value, so the parts cannot drift
  // apart: the disc slides out, the pair re-centres, and the disc turns.
  const discX = useTransform(travel, (t) => `${String(t * DISC_TRAVEL * 100)}%`);
  const groupX = useTransform(travel, (t) => `${String(-t * GROUP_SHIFT * 100)}%`);
  // Rolling without slipping: a disc that travels d of its own widths turns
  // 2d radians. The turn is tied to the travel, so it slows exactly as the
  // slide does instead of spinning on its own.
  const turn = useTransform(travel, (t) => (reduced ? 0 : t * DISC_TRAVEL * 2 * (180 / Math.PI)));

  if (phase === 'gone') return null;
  const message = complete ? INTRO_DONE_MESSAGE : (messages[messageIndex] ?? '');
  const change = reduced ? REDUCED_TRANSITION : transition('base', 'standard');
  // Reduced motion keeps the cross-fade and drops the travel.
  const rise = reduced ? 0 : 8;

  return (
    <div
      className={['shelf-intro', phase === 'leaving' && 'shelf-intro--leaving']
        .filter(Boolean)
        .join(' ')}
      onPointerDown={() => {
        setDismissed(true);
      }}
    >
      <div className="shelf-intro__content">
        {/* A jewel case, and the disc sliding out of it as the covers arrive:
            the progress bar, drawn as the object the app is about. Moved only
            by transforms, driven by real progress — not a loop. */}
        <motion.div
          className="shelf-intro__case-group"
          role="progressbar"
          aria-label="Covers loaded"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(settled, total)}
          style={{ x: groupX }}
        >
          <motion.div className="shelf-intro__disc" aria-hidden="true" style={{ x: discX }}>
            {/* The rainbow is light on the disc, so it stays put while the
                disc turns under it; what visibly turns is the pressing — the
                hub ring's moulded text and the data edge. Without something
                asymmetric to watch, a turning disc looks still. */}
            <motion.svg
              viewBox="0 0 100 100"
              className="shelf-intro__disc-detail"
              style={{ rotate: turn }}
            >
              <defs>
                <path id="shelf-intro-hub-text" d="M 50 36.5 a 13.5 13.5 0 1 1 -0.01 0" />
              </defs>
              <circle cx="50" cy="50" r="49.2" className="shelf-intro__disc-rim" />
              <circle cx="50" cy="50" r="36" className="shelf-intro__disc-groove" />
              <circle cx="50" cy="50" r="27" className="shelf-intro__disc-groove" />
              {/* Where the data ends: a slightly darker band, off-centre in
                  tone, which is what catches the eye as it turns. */}
              <path d="M 50 7 A 43 43 0 0 1 93 50" className="shelf-intro__disc-edge" />
              <circle cx="50" cy="50" r="16.5" className="shelf-intro__disc-hub" />
              <circle cx="50" cy="50" r="11" className="shelf-intro__disc-stack" />
              <text className="shelf-intro__disc-text">
                <textPath href="#shelf-intro-hub-text">MYCDS · COMPACT DISC · 001 ·</textPath>
              </text>
            </motion.svg>
          </motion.div>
          <div className="shelf-intro__case" aria-hidden="true">
            <svg viewBox="0 0 100 100" className="shelf-intro__case-detail">
              <defs>
                <linearGradient id="shelf-intro-glare" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
                  <stop offset="0.35" stopColor="#fff" stopOpacity="0.08" />
                  <stop offset="0.36" stopColor="#fff" stopOpacity="0" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
                </linearGradient>
              </defs>
              {/* The hinge side of the case, with its moulded ridges. */}
              <rect x="0" y="0" width="8" height="100" className="shelf-intro__spine" />
              {[14, 30, 70, 86].map((y) => (
                <line key={y} x1="2" x2="6" y1={y} y2={y} className="shelf-intro__ridge" />
              ))}
              <rect x="0" y="0" width="100" height="100" fill="url(#shelf-intro-glare)" />
              <rect
                x="0.5"
                y="0.5"
                width="99"
                height="99"
                rx="2"
                className="shelf-intro__case-edge"
              />
            </svg>
          </div>
        </motion.div>

        <p className="shelf-intro__wordmark" aria-hidden="true">
          MyCDs
        </p>

        {/* The jokes are for sighted readers; announcing a new one every
            second would bury a screen reader user in chatter. */}
        <div className="shelf-intro__messages" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.p
              key={message}
              className="shelf-intro__message"
              initial={{ opacity: 0, y: rise }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -rise }}
              transition={change}
            >
              {message}
            </motion.p>
          </AnimatePresence>
        </div>
        <p className="visually-hidden" role="status">
          {ready ? 'Collection ready.' : 'Loading the collection’s covers.'}
        </p>

        {total > 0 && (
          <p className="shelf-intro__count" aria-hidden="true">
            {Math.min(settled, total)} of {total} covers
          </p>
        )}
      </div>

      <button
        type="button"
        className={['shelf-intro__skip', elapsed.skip && 'shelf-intro__skip--shown']
          .filter(Boolean)
          .join(' ')}
        // Hidden from everyone until it appears, so it cannot be tabbed to
        // while invisible.
        tabIndex={elapsed.skip ? 0 : -1}
        aria-hidden={!elapsed.skip}
        onClick={() => {
          setDismissed(true);
        }}
      >
        Show what’s here
      </button>
    </div>
  );
}
