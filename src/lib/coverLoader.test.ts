import { describe, expect, it, vi } from 'vitest';

import { CoverLoader, type CoverLoaderDeps } from './coverLoader';

/** A fetch whose responses the test settles by hand, in any order. */
function fakeNetwork() {
  const requests: {
    url: string;
    priority: unknown;
    settle: (response: Response | Error) => void;
  }[] = [];
  let objectUrls = 0;
  const deps: CoverLoaderDeps = {
    fetch: (url, init) =>
      new Promise<Response>((resolve, reject) => {
        requests.push({
          url,
          priority: init.priority,
          settle: (response) => {
            if (response instanceof Error) reject(response);
            else resolve(response);
          },
        });
      }),
    createObjectURL: () => {
      objectUrls += 1;
      return `blob:cover-${String(objectUrls)}`;
    },
    revokeObjectURL: vi.fn(),
  };
  const ok = () => new Response(new Blob(['x']), { status: 200 });
  return { deps, requests, ok };
}

/** Lets the loader's promise chain run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const url = (n: number) => `https://art.test/${String(n)}.jpg`;

describe('CoverLoader', () => {
  it('holds a loaded cover in memory, so a remounted tile gets it at once', async () => {
    const { deps, requests, ok } = fakeNetwork();
    const loader = new CoverLoader(deps);

    const release = loader.want(url(1));
    expect(loader.src(url(1))).toBeNull();
    requests[0]?.settle(ok());
    await flush();

    expect(loader.state(url(1))).toBe('ready');
    expect(loader.src(url(1))).toBe('blob:cover-1');
    release();

    // Scrolled away and back: no second request.
    loader.want(url(1));
    expect(requests).toHaveLength(1);
    expect(loader.src(url(1))).toBe('blob:cover-1');
  });

  it('serves covers on screen before anything prefetched', async () => {
    const { deps, requests, ok } = fakeNetwork();
    const loader = new CoverLoader(deps);

    loader.prefetch([url(10), url(11), url(12)]);
    // Idle screen: the background queue may use the network…
    expect(requests.map((r) => r.url)).toEqual([url(10), url(11), url(12)]);

    // …but once the screen wants covers, no new background work starts ahead of them.
    // Eight in flight at most: three background, then five for the screen.
    for (let n = 1; n <= 7; n += 1) loader.want(url(n));
    loader.prefetch([url(20)]);
    expect(requests.map((r) => r.url)).toEqual([
      url(10),
      url(11),
      url(12),
      url(1),
      url(2),
      url(3),
      url(4),
      url(5),
    ]);
    expect(requests.at(-1)?.priority).toBe('high');

    for (const request of requests) request.settle(ok());
    await flush();
    // The remaining on-screen covers go next, and only then the prefetch.
    expect(requests.slice(8).map((r) => r.url)).toEqual([url(6), url(7), url(20)]);
  });

  it('does not refetch or queue what it already has', async () => {
    const { deps, requests, ok } = fakeNetwork();
    const loader = new CoverLoader(deps);
    loader.prefetch([url(1)]);
    requests[0]?.settle(ok());
    await flush();
    loader.prefetch([url(1), url(2)]);
    expect(requests.map((r) => r.url)).toEqual([url(1), url(2)]);
  });

  it('marks a 404 as failed rather than retrying it', async () => {
    const { deps, requests } = fakeNetwork();
    const loader = new CoverLoader(deps);
    loader.want(url(1));
    requests[0]?.settle(new Response(null, { status: 404 }));
    await flush();
    expect(loader.state(url(1))).toBe('failed');
    expect(loader.isSettled(url(1))).toBe(true);
  });

  it('falls back to a plain image when a host refuses CORS', async () => {
    const { deps, requests } = fakeNetwork();
    const loader = new CoverLoader(deps);
    loader.want(url(1));
    loader.want(url(2));
    requests[0]?.settle(new TypeError('Failed to fetch'));
    requests[1]?.settle(new TypeError('Failed to fetch'));
    await flush();
    expect(loader.src(url(1))).toBe(url(1));
    // After repeated strikes the whole host is loaded directly.
    loader.want(url(3));
    expect(loader.state(url(3))).toBe('direct');
    expect(requests).toHaveLength(2);
  });

  it('loads directly where blobs are unavailable', () => {
    const loader = new CoverLoader(null);
    loader.want(url(1));
    expect(loader.src(url(1))).toBe(url(1));
    loader.markLoaded(url(1));
    expect(loader.isSettled(url(1))).toBe(true);
  });

  it('counts covers on screen that are still waiting', async () => {
    const { deps, requests, ok } = fakeNetwork();
    const loader = new CoverLoader(deps);
    const release = loader.want(url(1));
    loader.want(url(2));
    expect(loader.pendingCount()).toBe(2);
    requests[0]?.settle(ok());
    await flush();
    expect(loader.pendingCount()).toBe(1);
    release();
    expect(loader.pendingCount()).toBe(1);
  });

  it('gives up the queue slot of a tile scrolled away before its cover started', () => {
    const { deps, requests } = fakeNetwork();
    const loader = new CoverLoader(deps);
    for (let n = 1; n <= 8; n += 1) loader.want(url(n));
    const release = loader.want(url(9));
    release();
    expect(loader.state(url(9))).toBe('idle');
    expect(requests).toHaveLength(8);
  });

  it('notifies only the tile whose cover changed', async () => {
    const { deps, requests, ok } = fakeNetwork();
    const loader = new CoverLoader(deps);
    const one = vi.fn();
    const two = vi.fn();
    loader.subscribeUrl(url(1), one);
    loader.subscribeUrl(url(2), two);
    loader.want(url(1));
    requests[0]?.settle(ok());
    await flush();
    expect(one).toHaveBeenCalled();
    expect(two).not.toHaveBeenCalled();
  });
});
