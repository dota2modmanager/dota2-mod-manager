/* A value that changes where it stands: the old one lifts out as the new one rises into its place.
 *
 * Pressing "Clear" and seeing the size read 0 MB is already the answer, but only if the eye was on
 * the number when it changed; a figure that is simply different reads the same as one that never
 * moved. The swap is the confirmation that the press did something, where the press was made.
 * Nothing else about the row moves. */
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { dur, ease } from './tokens.ts';

/** `value` decides when to swap; `children`, when given, is what is drawn for it. */
export function Swap({ value, className = '', children }: { value: string | number | boolean; className?: string; children?: ReactNode }) {
  const transition = { duration: dur('--dur-base'), ease: ease('--ease-standard') };
  return (
    <span className={`swap ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(value)} className="swap-value" transition={transition}
          initial={{ opacity: 0, y: '0.5em' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '-0.5em' }}>
          {children ?? String(value)}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
