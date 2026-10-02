/* A part of a screen that is there only sometimes, opening to its height and closing to nothing
 * instead of appearing: the rows below make room as it opens rather than jumping, and nobody has to
 * find where the page went. */
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { dur, ease } from './tokens.ts';

export function Reveal({ show, className = '', children }: { show: boolean; className?: string; children: ReactNode }) {
  const quick = { duration: dur('--dur-base'), ease: ease('--ease-standard') };
  const open = { height: 'auto', opacity: 1, transition: { duration: dur('--dur-medium-long'), ease: ease('--ease-standard'), opacity: quick } };
  const closed = { height: 0, opacity: 0, transition: quick };
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div key="reveal" className={`reveal ${className}`} initial={closed} animate={open} exit={closed}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
