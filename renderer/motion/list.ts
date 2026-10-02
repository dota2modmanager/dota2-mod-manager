/* How an item of a list moves when the list changes around it, on every screen that has one: the
 * rows of My mods, the preset cards. Two movements and nothing else.
 *
 * Travel: an item whose place changed glides there, so the eye can follow the one it was looking at
 * instead of finding it again in a list drawn from scratch.
 *
 * Fold: an item that leaves takes its box with it (height, padding and border to nothing, and the
 * list's gap on one side, since a flex item of no height still has a gap on both), so the items
 * after it close the gap as it goes and need no animation of their own. */
import type { TargetAndTransition, Transition } from 'motion/react';
import { dur, ease, px } from './tokens.ts';

/** The glide of an item to its new place: for `transition` on a motion element with `layout`. */
export function travel(): Transition {
  return { layout: { duration: dur('--dur-medium-long'), ease: ease('--ease-standard') } };
}

/** An item folding out of a flex list whose gap is `gapToken`: for `exit`. */
export function foldAway(gapToken: string): TargetAndTransition {
  return {
    height: 0, paddingTop: 0, paddingBottom: 0, borderTopWidth: 0, borderBottomWidth: 0,
    marginTop: -px(gapToken), opacity: 0,
    transition: { duration: dur('--dur-base'), ease: ease('--ease-standard') },
  };
}
