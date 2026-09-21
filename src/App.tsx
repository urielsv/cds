import { AnimatePresence } from 'motion/react';
import { useCallback, useMemo, useState } from 'react';

import { generateFixtureCollection } from '@/dev/fixtureCollection';
import { DiscPanel } from '@/features/disc/DiscPanel';
import { Shelf } from '@/features/shelf/Shelf';
import { type DiscIndexEntry } from '@shared/disc';

/**
 * Application shell.
 *
 * Spike stage (spec task group 1): proves the pannable virtualised shelf and the
 * shared-element open transition against a generated fixture. Real data loading,
 * routing, search, filters and the upload flow follow in task groups 2 onward.
 */
export function App() {
  // 150 discs matches the current real collection. Raise this to 400 — the
  // expected ceiling — when profiling the shelf.
  const collection = useMemo(() => generateFixtureCollection(150), []);
  const [openDisc, setOpenDisc] = useState<DiscIndexEntry | null>(null);

  const handleOpen = useCallback((disc: DiscIndexEntry) => {
    setOpenDisc(disc);
  }, []);

  const handleClose = useCallback(() => {
    setOpenDisc(null);
  }, []);

  return (
    <>
      <header className="app-bar">
        <h1 className="app-bar__title">MyCDs</h1>
        <p className="app-bar__count">{collection.discs.length} discs</p>
      </header>

      <main className="app-main">
        <Shelf discs={collection.discs} onOpen={handleOpen} openDiscId={openDisc?.id ?? null} />
      </main>

      {/* popLayout keeps the shared-element pairing intact while the panel leaves. */}
      <AnimatePresence mode="popLayout">
        {openDisc && <DiscPanel key={openDisc.id} disc={openDisc} onClose={handleClose} />}
      </AnimatePresence>
    </>
  );
}
