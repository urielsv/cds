import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

import { Icon } from '@/components/Icon';
import { REDUCED_TRANSITION, transition } from '@/motion/tokens';

interface AdminSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wide sheets (the add flow) get more room on desktop. */
  wide?: boolean;
}

/** The glass sheet that owner-only flows open in. */
export function AdminSheet({ title, onClose, children, wide = false }: AdminSheetProps) {
  const reduced = useReducedMotion() ?? false;
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the first field, or failing that the sheet itself.
    const root = rootRef.current;
    const first = root?.querySelector<HTMLElement>(
      'input, textarea, button:not(.admin-sheet__close)',
    );
    (first ?? root)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <motion.div
      className="admin-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduced ? REDUCED_TRANSITION : transition('base')}
    >
      <button
        type="button"
        className="admin-layer__scrim"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
      />
      <motion.div
        ref={rootRef}
        className={`admin-sheet glass${wide ? ' admin-sheet--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
        transition={reduced ? REDUCED_TRANSITION : transition('slow', 'entrance')}
      >
        <header className="admin-sheet__header">
          <h2 id={titleId} className="admin-sheet__title">
            {title}
          </h2>
          <button type="button" className="icon-button admin-sheet__close" onClick={onClose}>
            <Icon name="close" size={18} />
            <span className="visually-hidden">Close</span>
          </button>
        </header>
        <div className="admin-sheet__body">{children}</div>
      </motion.div>
    </motion.div>
  );
}
