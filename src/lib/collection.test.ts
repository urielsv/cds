import { afterEach, describe, expect, it, vi } from 'vitest';

describe('loadDisc', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function freshModule() {
    vi.stubEnv('VITE_COLLECTION_INDEX_URL', 'https://blob.test/collection/index.json');
    vi.resetModules();
    return import('./collection');
  }

  it('fetches a disc once per session, however often it is opened', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 404 }));
    const { loadDisc } = await freshModule();
    await loadDisc('a');
    await loadDisc('a');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failure rather than remembering it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 503 }));
    const { loadDisc } = await freshModule();
    await expect(loadDisc('b')).rejects.toThrow();
    await expect(loadDisc('b')).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the response for next time when the panel closes before it lands', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 404 }));
    const { loadDisc } = await freshModule();
    const controller = new AbortController();
    const first = loadDisc('c', controller.signal);
    controller.abort();
    await expect(first).rejects.toThrow();
    await loadDisc('c');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
