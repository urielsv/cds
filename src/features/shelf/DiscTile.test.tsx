import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type DiscIndexEntry } from '@shared/disc';

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
    ...overrides,
  };
}

describe('DiscTile', () => {
  it('is a real button, so it is reachable and activatable by keyboard', () => {
    render(<DiscTile disc={makeDisc()} onOpen={vi.fn()} isOpen={false} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('names itself with title, artist and year for screen readers', () => {
    render(<DiscTile disc={makeDisc()} onOpen={vi.fn()} isOpen={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Discovery by Daft Punk, 2001');
  });

  it('omits the year from its name when the release date is unknown', () => {
    render(<DiscTile disc={makeDisc({ releaseDate: null })} onOpen={vi.fn()} isOpen={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Discovery by Daft Punk');
  });

  it('calls onOpen with the disc when activated', async () => {
    const onOpen = vi.fn();
    render(<DiscTile disc={makeDisc()} onOpen={onOpen} isOpen={false} />);

    await userEvent.click(screen.getByRole('button'));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: 'daft-punk-discovery-2001-0' });
  });

  it('can be activated with the keyboard', async () => {
    const onOpen = vi.fn();
    render(<DiscTile disc={makeDisc()} onOpen={onOpen} isOpen={false} />);

    screen.getByRole('button').focus();
    await userEvent.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the country of origin so pressings are identifiable on the shelf', () => {
    render(<DiscTile disc={makeDisc({ country: 'AR' })} onOpen={vi.fn()} isOpen={false} />);
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.getByText('Argentina')).toBeInTheDocument();
  });

  it('shows no country badge when the disc has no recorded origin', () => {
    const { container } = render(
      <DiscTile disc={makeDisc({ country: null })} onOpen={vi.fn()} isOpen={false} />,
    );
    expect(container.querySelector('.country-badge')).toBeNull();
  });

  it('keeps the cover decorative, since the button label already names the disc', () => {
    const { container } = render(<DiscTile disc={makeDisc()} onOpen={vi.fn()} isOpen={false} />);
    expect(container.querySelector('.disc-tile__cover')).toHaveAttribute('alt', '');
  });

  it('gives the cover explicit dimensions so loading cannot reflow the grid', () => {
    const { container } = render(<DiscTile disc={makeDisc()} onOpen={vi.fn()} isOpen={false} />);
    const cover = container.querySelector('.disc-tile__cover');
    expect(cover).toHaveAttribute('width', '300');
    expect(cover).toHaveAttribute('height', '300');
  });

  it('releases the cover while the disc is open, so the panel owns the shared element', () => {
    const { container } = render(<DiscTile disc={makeDisc()} onOpen={vi.fn()} isOpen={true} />);
    expect(container.querySelector('.disc-tile__cover')).toBeNull();
  });
});
