/* "Что внутри" of a preset card: catalog mods as pictures with their names under their category,
 * and a hero's items under the hero's portrait and name, top of the body first. Heroes past the
 * first few wait behind a button, so a preset of forty heroes opens to a screenful, not a page.
 * The heroes' names and portraits come from the game, once, when the first card is opened. */
import { useEffect, useState } from 'react';
import { catalogName } from '../ui/catalog-name.ts';
import { heroName } from '../ui/hero-name.ts';
import { Thumb } from '../library/Thumb.tsx';
import { tokenName } from './inside.ts';
import type { InsideItem, InsideModel } from './model.ts';

const HEROES_FIRST = 8;

let names: Record<string, string> | null = null;
let namesAsked = false;
const portraits: Record<string, string> = {};
const asked = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Names for every hero, portraits for these: asked of the game once each, kept for the session. */
function useHeroes(tokens: string[], on: boolean): void {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  useEffect(() => {
    if (!on) return;
    if (!namesAsked) {
      namesAsked = true;
      window.api.fx.heroes().then((r) => {
        if ('heroes' in r && r.heroes) names = Object.fromEntries(r.heroes.map((h) => [h.hero, h.name]));
        changed();
      }).catch(() => {});
    }
    const want = tokens.filter((t) => !asked.has(t));
    if (!want.length) return;
    want.forEach((t) => asked.add(t));
    window.api.cosmetics.heroPortraits(want).then((got) => { Object.assign(portraits, got); changed(); }).catch(() => {});
  }, [on, tokens.join(',')]);
}

function Tile({ item, cls }: { item: InsideItem; cls: string }) {
  const title = item.absent ? `${item.name} — ${L`не установлен`}` : item.hint ? `${item.name} · ${item.hint}` : item.name;
  return (
    <div className={`${cls}${item.absent ? ' is-absent' : ''}`} title={title}>
      <Thumb thumb={item.thumb} cls={`${cls}-pic`} />
      <span className={`${cls}-name`}>{catalogName(item.name)}</span>
    </div>
  );
}

export function PresetInside({ inside }: { inside: InsideModel }) {
  const [open, setOpen] = useState(false);
  const [allHeroes, setAllHeroes] = useState(false);
  const heroes = allHeroes ? inside.heroes : inside.heroes.slice(0, HEROES_FIRST);
  useHeroes(heroes.map((h) => h.hero), open);
  const items = inside.heroes.reduce((n, h) => n + h.items.length, 0);
  return (
    <details className="preset-all" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><span className="ms">expand_more</span>{L`Что внутри`}</summary>
      {open && (
        <div className="inside">
          {inside.groups.length > 0 && <div className="inside-cats">{inside.groups.map((g) => (
            <div key={g.id} className="inside-group">
              <div className="preset-group-head"><span className="ms">{g.icon}</span>{g.name}<span className="preset-group-n">{g.n}</span></div>
              <div className="inside-mods">{g.items.map((it, i) => <Tile key={i} item={it} cls="inside-mod" />)}</div>
            </div>
          ))}</div>}
          {inside.heroes.length > 0 && (
            <div className="inside-group">
              <div className="preset-group-head">
                <span className="ms">checkroom</span>{L`Вещи на героях`}
                <span className="preset-group-n">{L`${items} на ${inside.heroes.length} героях`}</span>
              </div>
              <div className="inside-heroes">
                {heroes.map((h) => (
                  <div key={h.hero} className="inside-hero">
                    <div className="inside-hero-head">
                      {portraits[h.hero]
                        ? <img className="inside-hero-pic" src={portraits[h.hero]} alt="" loading="lazy" />
                        : <span className="inside-hero-pic"><span className="ms">person</span></span>}
                      <span className="inside-hero-name">{heroName(names?.[h.hero] || tokenName(h.hero))}</span>
                      <span className="preset-group-n">{h.items.length}</span>
                    </div>
                    <div className="inside-items">{h.items.map((it, i) => <Tile key={i} item={it} cls="inside-item" />)}</div>
                  </div>
                ))}
              </div>
              {inside.heroes.length > HEROES_FIRST && (
                <button className="btn btn-ghost btn-xs inside-more" onClick={() => setAllHeroes(!allHeroes)}>
                  {allHeroes ? L`Свернуть` : L`Показать всех героев (ещё ${inside.heroes.length - HEROES_FIRST})`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </details>
  );
}
