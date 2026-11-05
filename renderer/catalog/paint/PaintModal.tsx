/* The window for a hero recoloured part by part (issue #422). The hero stands on the left as hero
 * selection shows him, with his own layers under him; on the right the colour for everything that
 * is on (the game's prismatic gems, or any), his abilities as their icons and the items picked for
 * him as their pictures. Each picture shows its colour as the build will put it (PaintTiles.tsx).
 * Reached from the hero's window in the item builder, and back to it. */
import type { CSSProperties } from 'react';
import { BuilderFoot, BuilderHead } from '../builder/parts.tsx';
import type { BuilderAction } from '../builder/model.ts';
import { AbilityTile, HeroCard, ItemTile, Swatch, type PaintCell } from './PaintTiles.tsx';

export type { PaintCell } from './PaintTiles.tsx';

export interface PaintModalModel {
  hero: string;
  /** his portrait out of the game, upright as hero selection has it; null until it comes */
  portrait: string | null;
  /** the colour the top swatch gives every layer that is on */
  all: string;
  /** the game's prismatic gems, offered as colours for all */
  gems: { key: string; name: string; hex: string }[];
  abilities: { key: string; name: string; picture: string | null; effect: PaintCell | null; icon: PaintCell | null }[];
  /** the rest of the hero: his other effects, his icon and portrait, his body's textures */
  own: { effects: PaintCell | null; portrait: PaintCell | null; body: PaintCell | null };
  items: { name: string; cell: PaintCell }[];
  /** layers on, of how many */
  on: number;
  total: number;
  /** the layers on, by name, for the line at the foot */
  summary: string;
  action: BuilderAction;
  busy: boolean;
  /** ValveResourceFormat is there to read the compressed icons; false: a button to download it */
  vrf: boolean;
  /** downloading it */
  gettingTool: boolean;
}

export interface PaintModalActions {
  back: () => void;
  close: () => void;
  toggle: (id: string) => void;
  color: (id: string, hex: string) => void;
  all: (hex: string) => void;
  /** every layer on, or every layer off */
  every: (on: boolean) => void;
  apply: () => void;
  getTool: () => void;
}

function AllColor({ m, actions }: { m: PaintModalModel; actions: PaintModalActions }) {
  const picked = m.gems.find((g) => g.hex.toLowerCase() === m.all.toLowerCase());
  return (
    <div className="paint-all">
      <Swatch color={m.all} label={L`Цвет для всех включённых`} onColor={actions.all} id="paintAll" cls="lg" />
      <div className="paint-all-text">
        <div className="paint-all-title">{L`Цвет для всех включённых`}{picked && <span className="paint-gem-name">{picked.name}</span>}</div>
        <div className="text-meta">{L`Потом любой слой можно перекрасить отдельно.`}</div>
        {m.gems.length > 0 && (
          <div className="arcana-gem-row paint-gems">
            {m.gems.map((g) => (
              <button key={g.key} className={`arcana-gem ${g === picked ? 'active' : ''}`} style={{ '--c': g.hex } as CSSProperties}
                title={g.name} aria-label={g.name} onClick={() => actions.all(g.hex)} />
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-sm btn-ghost paint-every" onClick={() => actions.every(m.on < m.total)}>
        <span className="ms">{m.on < m.total ? 'select_all' : 'deselect'}</span>{m.on < m.total ? L`Включить все` : L`Выключить все`}
      </button>
    </div>
  );
}

export function PaintModal({ m, actions }: { m: PaintModalModel; actions: PaintModalActions }) {
  return (
    <div className="modal-body item-picker-body paint-body">
      <BuilderHead back={m.hero} onBack={actions.back} title={L`Перекраска`} onClose={actions.close}
        sub={<><span>{L`свой цвет для каждой части героя`}</span><span>{`· ${L`слоёв включено: ${m.on} из ${m.total}`}`}</span></>} />

      <div className="paint-layout">
        <HeroCard name={m.hero} picture={m.portrait} effects={m.own.effects} portrait={m.own.portrait} body={m.own.body} actions={actions} />

        <div className="paint-main">
          <AllColor m={m} actions={actions} />

          {m.abilities.length > 0 && (
            <section>
              <div className="section-h item-fx-head"><span className="ms">bolt</span>{L`Способности`}</div>
              <div className="paint-grid">
                {m.abilities.map((a) => <AbilityTile key={a.key} name={a.name} picture={a.picture} effect={a.effect} icon={a.icon} actions={actions} />)}
              </div>
            </section>
          )}

          {m.items.length > 0 && (
            <section>
              <div className="section-h item-fx-head"><span className="ms">checkroom</span>{L`Предметы`}</div>
              <div className="paint-grid">
                {m.items.map((it) => <ItemTile key={it.cell.id} name={it.name} cell={it.cell} actions={actions} />)}
              </div>
            </section>
          )}

          {!m.vrf && (
            <div className="paint-tool">
              <span className="text-meta">{L`Иконки и тело почти все сжаты: их читает ValveResourceFormat, его нужно один раз скачать. Собирает их компилятор Valve из Dota 2 Workshop Tools. Без него они останутся как в игре.`}</span>
              <button className="btn btn-sm" id="paintToolBtn" disabled={m.gettingTool} onClick={actions.getTool}>
                <span className="ms">{m.gettingTool ? 'progress_activity' : 'download'}</span>{L`Скачать ValveResourceFormat`}
              </button>
            </div>
          )}
          <div className="modal-note">
            {L`Цвет берут частицы, где он записан числом. Часть эффектов красит текстура: они останутся как в игре. Тело красится целиком, кожа тоже.`}
          </div>
        </div>
      </div>

      <div className="item-picker-foot" id="paintFoot">
        <BuilderFoot action={m.busy ? { label: L`Собираю…`, icon: 'progress_activity', off: true } : m.action} onApply={actions.apply}
          summary={m.summary || L`Ни один слой не включён`} />
      </div>
    </div>
  );
}
