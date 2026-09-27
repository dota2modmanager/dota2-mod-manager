/* The cards of one list, with a heading wherever the group changes when the list is grouped.
 *
 * A long list arrives in two parts. The first screenful is drawn at once, inside the paint that
 * opens the screen, so the view transition captures it whole; the rest follows as a transition
 * React can split across frames. Drawing all 611 heroes in one go held the window for about 55 ms
 * (measured against the string templates it replaced, which never did); this way no single task
 * is that long, and nothing below the fold was going to be seen in the first frame anyway. */
import { startTransition, useEffect, useState, type ReactElement } from 'react';
import type { Mod } from '../types.ts';
import { keyOf } from '../../core/keys.js';
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
  useEffect(() => {
    if (!whole) startTransition(() => setWhole(true));
  }, [whole]);

  if (!mods.length) return emptyText ? <div className="empty-note">{emptyText}</div> : null;
  const shown = whole ? mods : mods.slice(0, FIRST_PASS);
  const out: ReactElement[] = [];
  let last: string | null | undefined;
  shown.forEach((m, i) => {
    if (grouped && m._group !== last) {
      out.push(<div key={`group:${i}`} className="group-title">{m._group || tr('Прочее')}</div>);
      last = m._group;
    }
    out.push(<ModCard key={keyOf(m._cat, m.name, null)} mod={m} index={i} withCat={withCat} onOpen={onOpen} onFavChanged={onFavChanged} />);
  });
  return <>{out}</>;
}
