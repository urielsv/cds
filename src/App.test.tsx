import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateFixtureCollection } from '@/dev/fixtureCollection';

import { App } from './App';

// The real loader imports the fixture dynamically, which is slow to transform
// on a cold test run; serve the same demo collection synchronously instead.
vi.mock('@/lib/collection', () => ({
  loadCollection: () => Promise.resolve({ index: generateFixtureCollection(150), isDemo: true }),
  loadDisc: () => Promise.resolve(null),
}));

/**
 * No API runs under test: the session check fails and the app treats the
 * visitor as signed out, which is exactly the public browsing experience.
 * With no index URL configured, the demo collection loads.
 */
describe('App', () => {
  beforeEach(() => {
    // Not `stubGlobal`: unstubbing all globals afterwards would also remove the
    // ResizeObserver stub the test setup installs.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has the collection name as its page heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'MyCDs' })).toBeInTheDocument();
  });

  it('loads the demo collection into the wall', async () => {
    render(<App />);
    expect(await screen.findByRole('application')).toHaveAccessibleName(/150 albums/);
    expect(screen.getByText('Demo collection')).toBeInTheDocument();
  });

  it('offers search in the floating bar', async () => {
    render(<App />);
    expect(await screen.findByRole('searchbox', { name: /search albums/i })).toHaveAttribute(
      'placeholder',
      'Search 150 albums',
    );
  });

  it('reports how many albums match a search, without removing any', async () => {
    render(<App />);
    const input = await screen.findByRole('searchbox', { name: /search albums/i });
    await userEvent.type(input, 'daft punk');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/of 150/);
    });
    expect(screen.getByRole('application')).toHaveAccessibleName(/150 albums, \d+ matching/);
  });

  it('mirrors the search into the URL so it can be shared', async () => {
    render(<App />);
    const input = await screen.findByRole('searchbox', { name: /search albums/i });
    await userEvent.type(input, 'air');
    await waitFor(() => {
      expect(window.location.search).toBe('?q=air');
    });
  });

  it('clears search and filters in one tap', async () => {
    render(<App />);
    const input = await screen.findByRole('searchbox', { name: /search albums/i });
    await userEvent.type(input, 'daft');
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(input).toHaveValue('');
  });

  it('opens the filter panel with facets drawn from the collection', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^filters/i }));
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Genre' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Artist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /owner sign in/i })).toBeInTheDocument();
  });

  it('counts active filters on the filter button', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^filters/i }));
    await userEvent.click(screen.getByRole('button', { name: /^1990s/ }));
    expect(screen.getByRole('button', { name: /filters, 1 active/i })).toBeInTheDocument();
  });

  it('opens the arrange menu', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Arrange' }));
    expect(await screen.findByRole('radio', { name: /colour/i })).toBeInTheDocument();
  });

  it('shows no add button to a visitor', async () => {
    render(<App />);
    await screen.findByRole('application');
    expect(screen.queryByRole('button', { name: /add an album/i })).not.toBeInTheDocument();
  });

  it('does not show a disc until a cover is opened', () => {
    render(<App />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
