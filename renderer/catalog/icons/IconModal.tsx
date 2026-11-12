/* The window for a hero's ability icons picked from his own cosmetics' (src/ability-icons-service.ts):
 * a hero, then each of his abilities as a row of pictures, the game's own first and then every icon
 * an item or set of his shows for it. A click puts it on at once (it is a copy of the game's own file,
 * no compiler), and the plain one takes it off. The heroes are the sound window's grid
 * (sounds/SoundHeroes.tsx); the cards are the tower and tree window's (.map-card). */
import { SoundHeroes, SoundHeroHead } from '../sounds/SoundHeroes.tsx';
import type { AbilityIconChoice, AbilityIconsEntry } from '../../api/icons.ts';

export interface IconModalModel {
  heroes: { id: string; name: string }[];
  portraits: Record<string, string>;
  /** heroes with an icon picked */
  picked: string[];
  heroFilter: string;
  hero: string | null;
  abilities: AbilityIconsEntry[];
  /** ability -> the icon on it now; an ability not here has the game's own */
  picks: Record<string, string>;
  /** pictures by icon name (an ability's own, or a cosmetic's); one missing draws a glyph */
  pictures: Record<string, string>;
  /** the ability being put on, while it is */
  busy: string | null;
  /** ValveResourceFormat is there to read the compressed pictures */
  vrf: boolean;
  gettingTool: boolean;
}

export interface IconModalActions {
  close: () => void;
  hero: (id: string) => void;
  heroFilter: (text: string) => void;
  /** back to every hero */
  heroes: () => void;
  /** an icon on an ability; null puts the game's own back */
  pick: (ability: string, icon: string | null) => void;
  clear: () => void;
  getTool: () => void;
}

/** What a choice says under its picture: its item, and the style when the item has more than one. */
export function choiceLabel(c: AbilityIconChoice, all: AbilityIconChoice[]): string {
  const styled = c.style != null && all.filter((o) => o.item === c.item).length > 1;
  return styled ? `${c.item} · ${L`стиль`} ${(c.style as number) + 1}` : c.item;
}

function Card({ picture, name, on, busy, pick }: { picture: string | undefined; name: string; on: boolean; busy: boolean; pick: () => void }) {
  return (
    <button className={`map-card icon-card ${on ? 'on' : ''}`} title={name} aria-pressed={on} disabled={busy} onClick={pick}>
      {picture ? <img className="map-card-pic icon-card-pic" src={picture} alt="" draggable={false} />
        : <span className="map-card-pic icon-card-pic"><span className="ms">{busy ? 'progress_activity' : 'bolt'}</span></span>}
      <span className="map-card-name">{name}</span>
      {on && <span className="ms map-card-check">check_circle</span>}
    </button>
  );
}

function AbilityRow({ a, m, pick }: { a: AbilityIconsEntry; m: IconModalModel; pick: IconModalActions['pick'] }) {
  const now = m.picks[a.ability] ?? null;
  const busy = m.busy === a.ability;
  return (
    <div className="map-side icon-ability" data-ability={a.ability}>
      <div className="map-side-label">{a.name} <span className="text-meta">{a.choices.length + 1}</span></div>
      <div className="map-cards icon-cards">
        <Card picture={m.pictures[a.ability]} name={L`Из игры`} on={!now} busy={busy} pick={() => { if (now) pick(a.ability, null); }} />
        {a.choices.map((c) => (
          <Card key={c.icon} picture={m.pictures[c.icon]} name={choiceLabel(c, a.choices)} on={now === c.icon} busy={busy}
            pick={() => { if (now !== c.icon) pick(a.ability, c.icon); }} />
        ))}
      </div>
    </div>
  );
}

export function IconModal({ m, actions }: { m: IconModalModel; actions: IconModalActions }) {
  const picked = Object.keys(m.picks).length;
  return (
    <div className="modal-body icon-picks">
      <div className="modal-title-row">
        <div className="modal-title">{L`Иконки способностей`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Любая иконка способности из предметов этого героя`}</span></div>

      {!m.hero && <SoundHeroes m={{ heroes: m.heroes, portraits: m.portraits, sounded: m.picked, query: m.heroFilter, mark: { icon: 'imagesmode', title: L`Иконки выбраны` } }}
        pick={actions.hero} search={actions.heroFilter} />}

      {m.hero && (
        <>
          <SoundHeroHead name={m.heroes.find((h) => h.id === m.hero)?.name || m.hero} portrait={m.portraits[m.hero]} back={actions.heroes} />
          <div className="icon-abilities">
            {m.abilities.map((a) => <AbilityRow key={a.ability} a={a} m={m} pick={actions.pick} />)}
            {!m.abilities.length && <div className="share-hint">{L`У этого героя нет других иконок`}</div>}
          </div>
          {!m.vrf && (
            <div className="paint-tool">
              <span className="text-meta">{L`Почти все иконки сжаты: чтобы их показать, нужен ValveResourceFormat, его нужно один раз скачать. Ставятся они и без него.`}</span>
              <button className="btn btn-sm" id="iconToolBtn" disabled={m.gettingTool} onClick={actions.getTool}>
                <span className="ms">{m.gettingTool ? 'progress_activity' : 'download'}</span>{L`Скачать ValveResourceFormat`}
              </button>
            </div>
          )}
          {picked > 0 && (
            <div className="modal-actions">
              <button className="btn btn-ghost" id="iconClearBtn" disabled={!!m.busy} onClick={actions.clear}>
                <span className="ms">restart_alt</span>{L`Вернуть все из игры`}
              </button>
            </div>
          )}
        </>
      )}

      <div className="modal-note">
        {L`Иконку видишь только ты. Она стоит и поверх надетых предметов: их иконки этой способности тоже заменяются на выбранную.`}
      </div>
    </div>
  );
}
