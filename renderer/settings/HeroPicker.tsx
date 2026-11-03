/* A hero typed by name, for the look on everybody (settings/EveryoneBlock.tsx): the heroes built
 * and not chosen yet that match drop down under the field, best first (settings/hero-suggest.ts).
 * Enter takes the highlighted one, the arrows move it, Escape empties the field. A hundred heroes
 * in a list to scroll was the thing this replaced. */
import { useState } from 'react';
import { heroSuggestions, type HeroChoice } from './hero-suggest.ts';

export function HeroPicker({ built, chosen, names, onPick }: {
  built: HeroChoice[]; chosen: string[]; names: Map<string, string>; onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  // shut by leaving the field or by Escape, open again by typing: a focus event is not fired when
  // the window itself is not the active one, so the list does not wait for one
  const [shut, setShut] = useState(false);
  const found = heroSuggestions(built, chosen, query);
  const open = !shut && found.length > 0;
  const pick = (h: HeroChoice | undefined) => {
    if (!h) return;
    onPick(h.id);
    setQuery('');
    setHi(0);
  };
  return (
    <div className={`select-wrap custom-select-wrap hero-picker ${open ? 'open' : ''}`}>
      <input
        className="input" id="everyoneHeroInput" type="text" spellCheck={false} autoComplete="off"
        placeholder={L`Начни вводить имя героя…`} aria-label={L`Добавить героя…`}
        role="combobox" aria-expanded={open} aria-controls="everyoneHeroList" aria-autocomplete="list"
        aria-activedescendant={open ? `everyoneHero-${found[Math.min(hi, found.length - 1)].id}` : undefined}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setHi(0); setShut(false); }}
        onFocus={() => setShut(false)}
        // a click on a suggestion is a mousedown that keeps the focus (below), so the blur is a real leave
        onBlur={() => setShut(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, found.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(found[Math.min(hi, found.length - 1)]); }
          else if (e.key === 'Escape') { setQuery(''); setHi(0); setShut(true); }
        }}
      />
      {open && (
        <ul className="custom-select-menu" id="everyoneHeroList" role="listbox">
          {found.map((h, i) => (
            <li key={h.id} id={`everyoneHero-${h.id}`} role="option" aria-selected={i === hi}
              className={`custom-select-option ${i === hi ? 'highlighted' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setHi(i)}>
              <span className="option-label">{names.get(h.id) ?? h.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
