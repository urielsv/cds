import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coverLoader } from '@/lib/coverLoader';
import { INTRO_MESSAGES, introSequence } from './introMessages';
import { ShelfIntro } from './ShelfIntro';

const urls = Array.from({ length: 10 }, (_, i) => `https://x.test/${String(i)}.jpg`);

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Lets the lift's frame and fade timers run. */
const finishFade = () => {
  advance(1000);
};

const load = (list: readonly string[]) => {
  act(() => {
    for (const url of list) coverLoader.markLoaded(url);
  });
};

describe('ShelfIntro', () => {
  beforeEach(() => {
    coverLoader.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens with the plain message and counts covers as they arrive', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    expect(container).toHaveTextContent('Loading the best albums…');
    act(() => {
      coverLoader.markLoaded(urls[0] ?? '');
      coverLoader.markFailed(urls[1] ?? '');
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(container).toHaveTextContent('2 of 10 covers');
  });

  it('moves on to another message while it waits', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    advance(1400);
    expect(container.querySelector('.shelf-intro__messages')).not.toHaveTextContent(
      /^Loading the best albums…$/,
    );
  });

  it('keeps the rotating lines away from screen readers', () => {
    render(<ShelfIntro urls={urls} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the collection’s covers.');
  });

  it('lifts as soon as the whole first screen is in', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    load(urls);
    finishFade();
    expect(container.querySelector('.shelf-intro')).toBeNull();
  });

  it('waits for every cover on the first screen, not most of them', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    load(urls.slice(0, 9));
    advance(4000);
    expect(container.querySelector('.shelf-intro--leaving')).toBeNull();
    load(urls.slice(9));
    finishFade();
    expect(container.querySelector('.shelf-intro')).toBeNull();
  });

  it('counts a cover given up on as done, so a dead link cannot hold it', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    load(urls.slice(0, 9));
    act(() => {
      coverLoader.markFailed(urls[9] ?? '');
    });
    finishFade();
    expect(container.querySelector('.shelf-intro')).toBeNull();
  });

  it('does not count a cover fetched but not yet painted', () => {
    render(<ShelfIntro urls={urls} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('never holds the wall back for long', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    advance(10_000);
    finishFade();
    expect(container.querySelector('.shelf-intro')).toBeNull();
  });

  it('offers a way to skip ahead, but only after a moment', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    expect(screen.queryByRole('button', { name: 'Show what’s here' })).toBeNull();
    advance(1500);
    fireEvent.click(screen.getByRole('button', { name: 'Show what’s here' }));
    finishFade();
    expect(container.querySelector('.shelf-intro')).toBeNull();
  });

  it('lifts at once on a touch', () => {
    const { container } = render(<ShelfIntro urls={urls} />);
    const intro = container.querySelector('.shelf-intro');
    if (!intro) throw new Error('no intro');
    fireEvent.pointerDown(intro);
    finishFade();
    expect(container.querySelector('.shelf-intro')).toBeNull();
  });

  it('lifts straight away for a screen with no artwork', () => {
    const { container } = render(<ShelfIntro urls={[]} />);
    finishFade();
    expect(container.querySelector('.shelf-intro')).toBeNull();
  });
});

describe('introSequence', () => {
  it('always starts with the plain message and uses every line once', () => {
    const sequence = introSequence(() => 0.42);
    expect(sequence[0]).toBe(INTRO_MESSAGES[0]);
    expect([...sequence].sort()).toEqual([...INTRO_MESSAGES].sort());
  });

  it('varies the order between visits', () => {
    expect(introSequence(() => 0)).not.toEqual(introSequence(() => 0.99));
  });
});
