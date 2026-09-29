/* How the rows of My mods move. The load order is the thing this screen is about, so a row is a
 * thing with a place: when the order changes from the menu it travels to its new place, when a mod
 * is removed or a search leaves it out it folds away and the rows below close the gap, and a pack
 * folds open instead of popping its members in. Read once: every row shares it. The travel and the
 * fold are the ones every list shares (motion/list.ts); the pack's fold is this screen's own.
 *
 * What does not move: a drop at the end of a drag. The rows are already where they end up
 * (library/drag.ts), so that redraw measures nothing (layoutDependency in Rows.tsx). */
import type { TargetAndTransition, Transition } from 'motion/react';
import { dur, ease, px } from '../motion/tokens.ts';
import { foldAway, travel } from '../motion/list.ts';

let cached: { transition: Transition; leave: TargetAndTransition; fold: TargetAndTransition; unfold: TargetAndTransition; moveMs: number } | null = null;

export function rowMotion(): NonNullable<typeof cached> {
  if (!cached) {
    const move = { duration: dur('--dur-medium-long'), ease: ease('--ease-standard') };
    const quick = { duration: dur('--dur-base'), ease: ease('--ease-standard') };
    cached = {
      transition: travel(),
      moveMs: move.duration * 1000,
      leave: foldAway('--space-2'),
      /* a pack's members, in a fold that is only a height: the block inside keeps its margins and
         its rule, and the fold cancels the list's gap while it has no height */
      fold: { height: 0, opacity: 0, marginTop: -px('--space-2'), transition: quick },
      unfold: { height: 'auto', opacity: 1, marginTop: 0, transition: { ...move, opacity: quick } },
    };
  }
  return cached;
}
