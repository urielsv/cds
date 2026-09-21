import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

/**
 * Note: jsdom reports a zero-size scroll container, so the virtualised shelf
 * mounts no tiles here. Tile behaviour is covered directly in
 * `features/shelf/DiscTile.test.tsx` rather than through the virtualiser.
 */
describe('App', () => {
  it('renders the collection title as the page heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'MyCDs' })).toBeInTheDocument();
  });

  it('reports how many discs are in the collection', () => {
    render(<App />);
    const header = screen.getByRole('banner');
    expect(within(header).getByText('150 discs')).toBeInTheDocument();
  });

  it('renders a scrollable shelf region', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.shelf')).not.toBeNull();
  });

  it('does not render the disc panel until a tile is opened', () => {
    render(<App />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
