/* How a card moves when the list around it changes: a chip or a filter narrows the grid, and the
 * cards that stay slide to their new places while the ones that go fade out, so the eye can follow
 * a mod it was looking at instead of finding it again in a grid drawn from scratch. A card coming
 * in plays the entrance it always had (cardIn in catalog.css). Read once: every card shares it. */
import type { Transition, TargetAndTransition } from 'motion/react';
import { dur, ease } from '../motion.ts';

let cached: { transition: Transition; exit: TargetAndTransition } | null = null;

export function cardMotion(): { transition: Transition; exit: TargetAndTransition } {
  if (!cached) {
    cached = {
      transition: { layout: { duration: dur('--dur-medium-long'), ease: ease('--ease-standard') } },
      exit: { opacity: 0, scale: 0.96, transition: { duration: dur('--dur-fast'), ease: ease('--ease-accelerate') } },
    };
  }
  return cached;
}
