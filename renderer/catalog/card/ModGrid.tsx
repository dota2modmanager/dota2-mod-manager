/* The cards of one list, with a heading wherever the group changes when the list is grouped.
 *
 * A long list arrives in two parts. The first screenful is drawn at once, inside the paint that
 * opens the screen, so the view transition captures it whole; the rest follows as a transition
 * React can split across frames. Drawing all 611 heroes in one go held the window for about 55 ms
 * (measured against the string templates it replaced, which never did); this way no single task
 * is that long, and nothing below the fold was going to be seen in the first frame anyway. */
import { startTransition, useEffect, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cardMotion } from './card-motion.ts';
import type { Mod } from '../types.ts';
import { keyOf } from '../../core/keys.ts';
import { ModCard } from './ModCard.tsx';

/** Cards drawn in the first pass: more than a 4K window shows at the smallest card size. */
export const FIRST_PASS = 60;

export interface GridProps {
  mods: Mod[];
  /** a heading above each run of one group (a hero, a creep type) */
  grouped?: boolean;
  withCat?: boolean;
  /** what an empty list says; nothing at all when left out */
  emptyText?: string;
  onOpen: (mod: Mod, card: HTMLElement) => void;
  onFavChanged: () => void;
}

export function ModGrid({ mods, grouped = false, withCat = false, emptyText, onOpen, onFavChanged }: GridProps) {
  const [whole, setWhole] = useState(mods.length <= FIRST_PASS);
  // A list that grows by more than a screenful at once - a chip turned off, taking Heroes from 60
  // back to 614 - arrives in two parts too, the way a new screen does.
  const [count, setCount] = useState(mods.length);
  if (mods.length !== count) {
    setCount(mods.length);
    if (mods.length - count > FIRST_PASS) setWhole(false);
  }
  useEffect(() => {
    if (!whole) startTransition(() => setWhole(true));
  }, [whole]);

  if (!mods.length) return emptyText ? <div className="empty-note">{emptyText}</div> : null;
  const shown = whole ? mods : mods.slice(0, FIRST_PASS);
  /* The first screenful moves: a chip that narrows the list slides the cards that stay into their
   * new places and fades out the ones that go (popLayout: a leaving card stops holding its place,
   * so the rest move at once). Everything past it is plain markup beside it, changed in place.
   * Wrapping all 614 heroes cost up to 100 ms per chip - a measure and a style for every card,
   * and a motion element per card to mount - where the same change with nothing animated never
   * passed 10 ms; and those cards are below the fold, where nobody sees them move anyway. */
  const moving: ReactElement[] = [];
  const still: ReactElement[] = [];
  let last: string | null | undefined;
  shown.forEach((m, i) => {
    const moves = i < FIRST_PASS;
    const into = moves ? moving : still;
    if (grouped && m._group !== last) {
      const title = m._group || tr('Прочее');
      into.push(moves
        ? <motion.div key={`group:${m._group ?? ''}`} layout="position" exit={cardMotion().exit} transition={cardMotion().transition}
          className="group-title">{title}</motion.div>
        : <div key={`group:${m._group ?? ''}`} className="group-title">{title}</div>);
      last = m._group;
    }
    into.push(<ModCard key={keyOf(m._cat ?? '', m.name, null)} mod={m} index={i} withCat={withCat} moves={moves}
      onOpen={onOpen} onFavChanged={onFavChanged} />);
  });
  return (
    <>
      <AnimatePresence mode="popLayout" initial={false}>{moving}</AnimatePresence>
      {still}
    </>
  );
}
