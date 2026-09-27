/* How a card moves when the list around it changes: a chip or a filter narrows the grid, and the
 * cards that stay slide to their new places while the ones that go fade out, so the eye can follow
 * a mod it was looking at instead of finding it again in a grid drawn from scratch. A card coming
 * in plays the entrance it always had (cardIn in catalog.css). Read once: every card shares it. */
import type { Transition, TargetAndTransition } from 'motion/react';
import { dur, ease } from '../motion.ts';

let cached: { transition: Transition; exit: TargetAndTransition } | null = null;

export function cardMotion(): { transition: Transition; exit: TargetAndTransition } {
  if (!cached) {
    /* A card that goes and a card that takes its place share the spot for a moment, and two names
     * printed over each other read as a glitch. So the one leaving fades on a curve that is mostly
     * gone in its first half (standard, not the ease-in a lone exit would get), and the ones
     * moving set off after that first half. */
    const fast = dur('--dur-fast');
    cached = {
      transition: { layout: { duration: dur('--dur-medium-long'), ease: ease('--ease-standard'), delay: fast / 2 } },
      exit: { opacity: 0, scale: 0.94, transition: { duration: fast, ease: ease('--ease-standard') } },
    };
  }
  return cached;
}
