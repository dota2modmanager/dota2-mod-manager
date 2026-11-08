/* The window for a hero recoloured part by part (issue #422). On the left the hero in 3D, in what he
 * wears, painted as each colour is picked (preview-paint.ts), with his own layers under him; on the
 * right the editor for the layer picked or for all of them (PaintEditor.tsx), then his abilities as
 * their icons and his items as their pictures, each with its layers. Reached from the hero's window
 * in the item builder, and back to it. */
import { BuilderFoot, BuilderHead } from '../builder/parts.tsx';
import type { BuilderAction } from '../builder/model.ts';
import type { PreviewSlot } from '../../api/preview3d.ts';
import { Preview3d } from '../preview3d/Preview3d.tsx';
import { AbilityTile, HeroLayers, ItemTile, type PaintCell } from './PaintTiles.tsx';
import { PaintEditor, type PaintEditorActions, type PaintEditorModel } from './PaintEditor.tsx';
import type { PreviewPaint } from './preview-paint.ts';

export type { PaintCell } from './PaintTiles.tsx';

export interface PaintModalModel {
  hero: string;
  /** his portrait out of the game, upright as hero selection has it; null until it comes */
  portrait: string | null;
  /** the 3D stage: the hero in what each slot wears, and its colours; null where he has no model to show */
  preview: { hero: string; slots: PreviewSlot[]; sig: string; paint: PreviewPaint } | null;
  editor: PaintEditorModel;
  abilities: { key: string; name: string; picture: string | null; effect: PaintCell | null; icon: PaintCell | null }[];
  /** the rest of the hero: his other effects, his icon and portrait, his body's textures */
  own: { effects: PaintCell | null; portrait: PaintCell | null; body: PaintCell | null };
  /** what he wears: its own colour (its model's textures) and its effect */
  items: { name: string; model: PaintCell | null; effect: PaintCell | null }[];
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
  select: (id: string) => void;
  editor: PaintEditorActions;
  /** every layer on, or every layer off */
  every: (on: boolean) => void;
  apply: () => void;
  getTool: () => void;
}

export function PaintModal({ m, actions }: { m: PaintModalModel; actions: PaintModalActions }) {
  const portrait = m.portrait
    ? <img className="paint-stage-fallback" src={m.portrait} alt="" draggable={false} />
    : <span className="ms paint-stage-fallback">person</span>;
  return (
    <div className="modal-body item-picker-body paint-body">
      <BuilderHead back={m.hero} onBack={actions.back} title={L`Перекраска`} onClose={actions.close}
        sub={<><span>{L`свой цвет для каждой части героя`}</span><span>{`· ${L`слоёв включено: ${m.on} из ${m.total}`}`}</span></>} />

      <div className="paint-layout">
        <aside className="paint-hero">
          <div className="paint-stage" id="paintStage">
            {m.preview
              ? <Preview3d hero={m.preview.hero} slots={m.preview.slots} sig={m.preview.sig} paint={m.preview.paint} fallback={portrait} />
              : portrait}
          </div>
          <HeroLayers name={m.hero} picture={m.portrait} effects={m.own.effects} portrait={m.own.portrait} body={m.own.body} actions={actions} />
        </aside>

        <div className="paint-main">
          <PaintEditor m={m.editor} actions={actions.editor} />
          <div className="paint-every-row">
            <button className="btn btn-sm btn-ghost paint-every" onClick={() => actions.every(m.on < m.total)}>
              <span className="ms">{m.on < m.total ? 'select_all' : 'deselect'}</span>{m.on < m.total ? L`Включить все` : L`Выключить все`}
            </button>
          </div>

          {m.items.length > 0 && (
            <section>
              <div className="section-h item-fx-head"><span className="ms">checkroom</span>{L`Предметы`}</div>
              <div className="paint-grid">
                {m.items.map((it) => <ItemTile key={(it.model ?? it.effect)!.id} name={it.name} model={it.model} effect={it.effect} actions={actions} />)}
              </div>
            </section>
          )}

          {m.abilities.length > 0 && (
            <section>
              <div className="section-h item-fx-head"><span className="ms">bolt</span>{L`Способности`}</div>
              <div className="paint-grid">
                {m.abilities.map((a) => <AbilityTile key={a.key} name={a.name} picture={a.picture} effect={a.effect} icon={a.icon} actions={actions} />)}
              </div>
            </section>
          )}

          {!m.vrf && (
            <div className="paint-tool">
              <span className="text-meta">{L`Иконки, тело и предметы почти все сжаты: их читает ValveResourceFormat, его нужно один раз скачать. Собирает их компилятор Valve из Dota 2 Workshop Tools. Без него они останутся как в игре.`}</span>
              <button className="btn btn-sm" id="paintToolBtn" disabled={m.gettingTool} onClick={actions.getTool}>
                <span className="ms">{m.gettingTool ? 'progress_activity' : 'download'}</span>{L`Скачать ValveResourceFormat`}
              </button>
            </div>
          )}
          <div className="modal-note">
            {L`Цвет берут частицы, где он записан числом. Часть эффектов красит текстура: они останутся как в игре. Предмет и тело красятся по своей текстуре цвета, в выбранном режиме.`}
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
