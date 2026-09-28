/* How the rows of My mods move. The load order is the thing this screen is about, so a row is a
 * thing with a place: when the order changes from the menu it travels to its new place, when a mod
 * is removed or a search leaves it out it folds away and the rows below close the gap, and a pack
 * folds open instead of popping its members in. Read once: every row shares it.
 *
 * What does not move: a drop at the end of a drag. The rows are already where they end up
 * (library/drag.ts), so that redraw measures nothing (layoutDependency in Rows.tsx). */
import type { TargetAndTransition, Transition } from 'motion/react';
import { dur, ease } from '../catalog/motion.ts';

/** A length token on :root, in pixels. */
const px = (token: string): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 0;

let cached: { transition: Transition; leave: TargetAndTransition; fold: TargetAndTransition; unfold: TargetAndTransition; moveMs: number } | null = null;

export function rowMotion(): NonNullable<typeof cached> {
  if (!cached) {
    const move = { duration: dur('--dur-medium-long'), ease: ease('--ease-standard') };
    const quick = { duration: dur('--dur-base'), ease: ease('--ease-standard') };
    /* A row that goes takes its box with it: height, padding and border to nothing, and the list's
     * gap on one side, since a flex item of no height still has a gap on both. The rows below follow
     * as it folds, so they need no animation of their own. */
    const folded = { height: 0, paddingTop: 0, paddingBottom: 0, borderTopWidth: 0, borderBottomWidth: 0, marginTop: -px('--space-2') };
    cached = {
      transition: { layout: move },
      moveMs: move.duration * 1000,
      leave: { ...folded, opacity: 0, transition: quick },
      /* a pack's members, in a fold that is only a height: the block inside keeps its margins and
         its rule, and the fold cancels the list's gap while it has no height */
      fold: { height: 0, opacity: 0, marginTop: -px('--space-2'), transition: quick },
      unfold: { height: 'auto', opacity: 1, marginTop: 0, transition: { ...move, opacity: quick } },
    };
  }
  return cached;
}
