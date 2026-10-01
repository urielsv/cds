import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type DiscIndexEntry } from '@shared/disc';

import { TILE_SIZE } from './camera';
import { coverLoader } from '@/lib/coverLoader';
import { DiscTile } from './DiscTile';

function makeDisc(overrides: Partial<DiscIndexEntry> = {}): DiscIndexEntry {
  return {
    id: 'daft-punk-discovery-2001-0',
    title: 'Discovery',
    artist: 'Daft Punk',
    releaseDate: '2001-03-12',
    country: 'FR',
    labels: ['Virgin'],
    format: 'CD',
    genres: ['house'],
    addedAt: '2026-01-01T00:00:00.000Z',
    thumbnail: {
      url: 'data:image/svg+xml,%3Csvg%2F%3E',
      width: 300,
      height: 300,
      placeholder: null,
      kind: 'front',
    },
    trackTitles: ['One More Time', 'Aerodynamic'],
    color: '#223344',
    ...overrides,
  };
}

function renderTile(overrides: Partial<ComponentProps<typeof DiscTile>> = {}) {
  const props: ComponentProps<typeof DiscTile> = {
    disc: makeDisc(),
    index: 3,
    placement: { column: 2, row: 1, span: 1 },
    dimmed: false,
    lifted: false,
    arrived: false,
    focusable: true,
    onOpen: vi.fn(),
    onFocusTile: vi.fn(),
    registerElement: vi.fn(),
    ...overrides,
  };
  return { ...render(<DiscTile {...props} />), props };
}

/** The cover arrives through the loader (a blob), so it appears a tick later. */
async function coverOf(container: HTMLElement): Promise<HTMLImageElement> {
  return waitFor(() => {
    const cover = container.querySelector<HTMLImageElement>('.disc-tile__cover');
    if (!cover) throw new Error('cover not rendered yet');
    return cover;
  });
}

describe('DiscTile', () => {
  beforeEach(() => {
    coverLoader.reset();
  });

  it('is a real button named with title, artist and year', () => {
    renderTile();
    expect(screen.getByRole('button')).toHaveAccessibleName('Discovery by Daft Punk, 2001');
  });

  it('omits the year from its name when the release date is unknown', () => {
    renderTile({ disc: makeDisc({ releaseDate: null }) });
    expect(screen.getByRole('button')).toHaveAccessibleName('Discovery by Daft Punk');
  });

  it('tells a screen reader when it does not match the search', () => {
    renderTile({ dimmed: true });
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Discovery by Daft Punk, 2001, not in results',
    );
    expect(screen.getByRole('button')).toHaveClass('disc-tile--dimmed');
  });

  it('stays openable when dimmed — searching never hides a disc', async () => {
    const { props } = renderTile({ dimmed: true });
    await userEvent.click(screen.getByRole('button'));
    expect(props.onOpen).toHaveBeenCalledWith(props.disc, 3);
  });

  it('can be activated with the keyboard', async () => {
    const { props } = renderTile();
    screen.getByRole('button').focus();
    await userEvent.keyboard('{Enter}');
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('is placed in world units with a transform, not layout properties', () => {
    renderTile();
    const tile = screen.getByRole('button');
    expect(tile.style.transform).toBe(
      `translate3d(${String(2 * TILE_SIZE)}px, ${String(TILE_SIZE)}px, 0)`,
    );
    expect(tile.style.left).toBe('');
  });

  it('draws a block at the size of its span', () => {
    renderTile({ placement: { column: 0, row: 0, span: 3 } });
    expect(Number.parseFloat(screen.getByRole('button').style.width)).toBeGreaterThan(
      3 * TILE_SIZE - 1,
    );
  });

  it('shows the average cover colour while the artwork loads', () => {
    renderTile();
    expect(screen.getByRole('button').style.backgroundColor).toBe('rgb(34, 51, 68)');
  });

  it('keeps the cover decorative with explicit dimensions', async () => {
    const { container } = renderTile();
    const cover = await coverOf(container);
    expect(cover).toHaveAttribute('alt', '');
    expect(cover).toHaveAttribute('width', '300');
    expect(cover).toHaveAttribute('height', '300');
  });

  it('draws a typographic cover when there is no artwork', () => {
    const { container } = renderTile({ disc: makeDisc({ thumbnail: null }) });
    expect(container.querySelector('.disc-tile__typeset')).toHaveTextContent('Discovery');
  });

  it('takes part in roving focus', () => {
    renderTile({ focusable: false });
    expect(screen.getByRole('button')).toHaveAttribute('tabindex', '-1');
  });

  it('marks itself as loading until its cover arrives', async () => {
    const { container } = renderTile();
    const tile = screen.getByRole('button');
    expect(tile).toHaveClass('disc-tile--pending');
    expect(coverLoader.pendingCount()).toBe(1);

    fireEvent.load(await coverOf(container));
    expect(tile).toHaveClass('disc-tile--loaded');
    expect(tile).not.toHaveClass('disc-tile--pending');
    expect(coverLoader.pendingCount()).toBe(0);
  });

  it('shows a cover already seen this session straight away, without a fade', () => {
    coverLoader.markLoaded(makeDisc().thumbnail?.url ?? '');
    renderTile();
    expect(screen.getByRole('button')).toHaveClass('disc-tile--loaded');
    expect(coverLoader.pendingCount()).toBe(0);
  });

  it('falls back to the typographic cover when the artwork fails to load', async () => {
    const { container } = renderTile();
    fireEvent.error(await coverOf(container));
    expect(container.querySelector('.disc-tile__cover')).toBeNull();
    expect(container.querySelector('.disc-tile__typeset')).toHaveTextContent('Discovery');
    expect(coverLoader.pendingCount()).toBe(0);
  });

  it('says what it is while its cover is on the way, and stops once it lands', async () => {
    const { container } = renderTile();
    expect(container.querySelector('.disc-tile__pending-label')).toHaveTextContent(
      'DiscoveryDaft Punk',
    );
    fireEvent.load(await coverOf(container));
    expect(container.querySelector('.disc-tile__pending-label')).toBeNull();
  });

  it('picks label ink that reads against the tile colour', () => {
    renderTile({ disc: makeDisc({ color: '#101010' }) });
    expect(screen.getByRole('button')).toHaveClass('disc-tile--ink-light');
  });
});
