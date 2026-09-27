/* The cards of one list, with a heading wherever the group changes when the list is grouped. */
import type { ReactElement } from 'react';
import type { Mod } from '../types.ts';
import { keyOf } from '../../core/keys.js';
import { ModCard } from './ModCard.tsx';

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
  if (!mods.length) return emptyText ? <div className="empty-note">{emptyText}</div> : null;
  const out: ReactElement[] = [];
  let last: string | null | undefined;
  mods.forEach((m, i) => {
    if (grouped && m._group !== last) {
      out.push(<div key={`group:${i}`} className="group-title">{m._group || tr('Прочее')}</div>);
      last = m._group;
    }
    out.push(<ModCard key={keyOf(m._cat, m.name, null)} mod={m} index={i} withCat={withCat} onOpen={onOpen} onFavChanged={onFavChanged} />);
  });
  return <>{out}</>;
}
