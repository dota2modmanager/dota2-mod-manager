/* The window for towers or trees out of the game's own looks (issues #446, #421): a grid of looks
 * for Radiant and one for Dire, each starting with the game's own, then the build. Each look is a
 * card with its picture: a tower set's item picture, or where the game has none (its building
 * effects, the game's own towers) and for every tree set, the model drawn (preview3d/model-thumb.ts)
 * once the card is up. */
import { useEffect, useState, type ReactNode } from 'react';
import { useCosmeticIcon } from '../cosmetic/CosmeticCard.tsx';
import type { MapKind, MapOption } from '../../api/content.ts';

export type Side = 'radiant' | 'dire';

export interface MapLookModalModel {
  kind: MapKind;
  options: MapOption[];
  /** the model each side stands in as the game ships */
  own: Record<Side, string>;
  /** the look picked per side, null for the game's own */
  chosen: Record<Side, string | null>;
  installed: Record<Side, string | null> | null;
  busy: boolean;
}

export interface MapLookModalActions {
  close: () => void;
  choose: (side: Side, id: string | null) => void;
  install: () => void;
  remove: () => void;
}

/** "Grasp of the Elder Gods - Radiant Towers" as "Grasp of the Elder Gods": the row already says the side. */
export const lookLabel = (name: string) =>
  name.replace(/\s*-?\s*(Radiant|Dire) Towers$/i, '').replace(/\s+Building Effects$/i, '') || name;

const SIDES: { side: Side; label: string }[] = [{ side: 'radiant', label: 'Radiant' }, { side: 'dire', label: 'Dire' }];

/** A tower set's picture, by its item's name, through the item pictures' loader; one the game has none of drawn from its model. */
function ItemPicture({ name, model }: { name: string; model: string | undefined }) {
  const src = useCosmeticIcon(name);
  if (src === null && model) return <ModelPicture model={model} />;
  return <Picture src={src} glyph="fort" />;
}

/** A tree set's picture, drawn out of its main model; three.js comes in only when one is asked for. */
function ModelPicture({ model }: { model: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let gone = false;
    void import('../preview3d/model-thumb.ts').then(({ modelThumb }) => modelThumb(model)).then((uri) => { if (!gone) setSrc(uri); }, () => { if (!gone) setSrc(null); });
    return () => { gone = true; };
  }, [model]);
  return <Picture src={src} glyph="park" />;
}

function Picture({ src, glyph }: { src: string | null | undefined; glyph: string }) {
  if (src) return <img className="map-card-pic" src={src} alt="" draggable={false} />;
  return <span className={`map-card-pic ${src === undefined ? 'loading' : ''}`}><span className="ms">{glyph}</span></span>;
}

function LookCard({ label, title, on, onPick, children }: { label: string; title?: string; on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button className={`map-card ${on ? 'on' : ''}`} title={title || label} aria-pressed={on} onClick={onPick}>
      {children}
      <span className="map-card-name">{label}</span>
      {on && <span className="ms map-card-check">check_circle</span>}
    </button>
  );
}

export function MapLookModal({ m, actions }: { m: MapLookModalModel; actions: MapLookModalActions }) {
  const towers = m.kind === 'towers';
  const same = m.installed && m.installed.radiant === m.chosen.radiant && m.installed.dire === m.chosen.dire;
  const none = !m.chosen.radiant && !m.chosen.dire;
  return (
    <div className="modal-body map-looks">
      <div className="modal-title-row">
        <div className="modal-title">{towers ? L`Башни из игры` : L`Деревья из игры`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Своя для каждой стороны · из файлов игры`}</span></div>
      {SIDES.map(({ side, label }) => (
        <div className="map-side" key={side}>
          <div className="map-side-label">{label}</div>
          <div className="map-cards" data-side={side}>
            {/* a side's own tree set is what "As in the game" already gives it, so its picture stands for the game's own */}
            <LookCard label={L`Как в игре`} on={!m.chosen[side]} onPick={() => actions.choose(side, null)}>
              <ModelPicture model={m.own[side]} />
            </LookCard>
            {m.options.filter((o) => o.sides.includes(side) && o.id !== side).map((o) => (
              <LookCard key={o.id} label={lookLabel(o.name)} title={o.name} on={m.chosen[side] === o.id} onPick={() => actions.choose(side, o.id)}>
                {towers ? <ItemPicture name={o.name} model={o.models[side]} /> : <ModelPicture model={o.models[side]!} />}
              </LookCard>
            ))}
          </div>
        </div>
      ))}
      <div className="modal-actions">
        {m.busy
          ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
          : same
            ? <button className="btn btn-primary" disabled><span className="ms">check</span>{L`Установлено`}</button>
            : <button className="btn btn-primary" id="mapInstallBtn" disabled={none} onClick={actions.install}>
              <span className="ms">download</span>{m.installed ? L`Применить` : L`Установить`}
            </button>}
        {m.installed && !m.busy && (
          <button className="btn btn-danger" id="mapRemoveBtn" onClick={actions.remove}><span className="ms">delete</span>{L`Убрать`}</button>
        )}
      </div>
      <div className="modal-note">
        {towers
          ? L`Модели башен и их обломков берутся из предметов игры. Эффекты, которые предмет создаёт сам, и его звуки в файл не входят.`
          : L`Меняются деревья, которые можно срубить. Деревья-декорации по краям карты встроены в саму карту и остаются как были.`}
      </div>
    </div>
  );
}
