/* The heroes of the sound window (SoundModal.tsx), and of the ability icons' (icons/IconModal.tsx): a search and every hero as hero selection shows
 * him, the ones with a sound of the user's already marked; once one is picked, him alone at the top
 * with a way back to the rest. */
import { PickerSearch } from '../builder/parts.tsx';

export interface SoundHeroesModel {
  heroes: { id: string; name: string }[];
  /** the selection portraits out of the game, by hero id; one missing draws its name alone */
  portraits: Record<string, string>;
  /** heroes with a sound of the user's on them */
  sounded: string[];
  query: string;
  /** the glyph and words on a hero already done; the sound window's when left out */
  mark?: { icon: string; title: string };
}

function Portrait({ src }: { src: string | undefined }) {
  return src ? <img className="sound-hero-pic" src={src} alt="" draggable={false} /> : <span className="sound-hero-pic"><span className="ms">person</span></span>;
}

/** Every hero, searchable. */
export function SoundHeroes({ m, pick, search }: { m: SoundHeroesModel; pick: (id: string) => void; search: (q: string) => void }) {
  const q = m.query.trim().toLowerCase();
  const shown = q ? m.heroes.filter((h) => h.name.toLowerCase().includes(q) || h.id.includes(q)) : m.heroes;
  const sounded = new Set(m.sounded);
  const mark = m.mark ?? { icon: 'graphic_eq', title: L`Есть свой звук` };
  return (
    <div className="sound-step">
      <PickerSearch id="soundHeroFilter" value={m.query} onChange={search} />
      <div className="sound-heroes" id="soundHeroes">
        {shown.map((h) => (
          <button key={h.id} className={`sound-hero ${sounded.has(h.id) ? 'has' : ''}`} data-hero={h.id} onClick={() => pick(h.id)}>
            <Portrait src={m.portraits[h.id]} />
            <span className="sound-hero-name">{h.name}</span>
            {sounded.has(h.id) && <span className="ms sound-hero-mark" title={mark.title}>{mark.icon}</span>}
          </button>
        ))}
        {!shown.length && <div className="share-hint">{L`Ничего не нашлось`}</div>}
      </div>
    </div>
  );
}

/** The hero picked, and the way back to the others. */
export function SoundHeroHead({ name, portrait, back }: { name: string; portrait: string | undefined; back: () => void }) {
  return (
    <div className="sound-hero-head">
      <Portrait src={portrait} />
      <span className="sound-hero-head-name">{name}</span>
      <button className="btn btn-ghost btn-sm" id="soundHeroBack" onClick={back}><span className="ms">swap_horiz</span>{L`Другой герой`}</button>
    </div>
  );
}
