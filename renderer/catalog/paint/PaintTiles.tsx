/* The pieces of the recolour window (PaintModal.tsx): a colour well, a layer's switch with its colour,
 * and a tile that shows a part of the hero in the colours it is getting. An icon layer that is on
 * shades the picture as the build will (shade.ts); an effect layer that is on rings it in its colour,
 * since an effect has no picture of its own to shade. A click on a picture picks its layer for the
 * editor above (PaintEditor.tsx); a click on a layer's name switches it, and picks it when it goes on. */
import type { CSSProperties, ReactNode } from 'react';
import { CosThumb } from '../builder/parts.tsx';
import { useShaded } from './shade.ts';
import type { PaintMode } from './paint-mode.ts';

/** One switch and colour, for one layer. */
export interface PaintCell { id: string; on: boolean; color: string; mode: PaintMode; selected: boolean }

export interface CellActions {
  toggle: (id: string) => void;
  color: (id: string, hex: string) => void;
  /** the layer the editor works on */
  select: (id: string) => void;
}

/** A colour well: the system's picker under a round swatch. */
export function Swatch({ color, label, onColor, id, cls = '' }: { color: string; label: string; onColor: (hex: string) => void; id?: string; cls?: string }) {
  return (
    <label className={`paint-swatch ${cls}`} style={{ '--c': color } as CSSProperties} title={label} id={id}>
      <input type="color" value={color} aria-label={label} onInput={(e) => onColor(e.currentTarget.value)} />
    </label>
  );
}

/** A layer's switch, its name on it, and its colour beside it. */
export function Chip({ cell, label, actions }: { cell: PaintCell; label: string; actions: CellActions }) {
  return (
    <span className={`paint-chip ${cell.on ? 'on' : ''} ${cell.selected ? 'sel' : ''}`} data-layer={cell.id} style={{ '--c': cell.color } as CSSProperties}>
      <button className="paint-chip-btn" role="switch" aria-checked={cell.on} onClick={() => actions.toggle(cell.id)}>{label}</button>
      <Swatch color={cell.color} label={label} onColor={(hex) => actions.color(cell.id, hex)} cls="sm" />
    </span>
  );
}

const ring = (fx: PaintCell | null): CSSProperties | undefined => (fx?.on ? { '--fx': fx.color } as CSSProperties : undefined);

/** A picture that picks the layer it shows for the editor; without a layer, just the picture. */
function Pic({ layer, label, cls, style, actions, children }: {
  layer: PaintCell | null; label: string; cls: string; style?: CSSProperties; actions: CellActions; children: ReactNode;
}) {
  if (!layer) return <span className={cls} style={style}>{children}</span>;
  return (
    <button className={`${cls} paint-pic-btn`} style={style} aria-pressed={layer.selected} aria-label={label} title={label}
      data-pick={layer.id} onClick={() => actions.select(layer.id)}>
      {children}
    </button>
  );
}

const picked = (...cells: (PaintCell | null)[]) => cells.some((c) => c?.selected);

/**
 * An ability: its icon, shaded while its icon layer is on, ringed while its effect is.
 * @param picture  the icon out of the game, null for none: the glyph stands in
 */
export function AbilityTile({ name, picture, effect, icon, actions }: {
  name: string; picture: string | null; effect: PaintCell | null; icon: PaintCell | null; actions: CellActions;
}) {
  const shown = useShaded(picture, icon?.on ? icon.color : null, icon?.mode);
  const on = !!(effect?.on || icon?.on);
  return (
    <div className={`paint-tile ${on ? 'on' : ''} ${picked(effect, icon) ? 'sel' : ''}`}>
      <Pic layer={effect ?? icon} label={name} cls={`paint-pic ${effect?.on ? 'fx' : ''}`} style={ring(effect)} actions={actions}>
        {shown ? <img src={shown} alt="" draggable={false} /> : <span className="ms">bolt</span>}
      </Pic>
      <span className="paint-tile-name" title={name}>{name}</span>
      <span className="paint-chips">
        {effect && <Chip cell={effect} label={L`Эффект`} actions={actions} />}
        {icon && <Chip cell={icon} label={L`Иконка`} actions={actions} />}
      </span>
    </div>
  );
}

/** An item the hero wears: its picture, ringed while its effects are getting a colour; its own colour and its effect as layers. */
export function ItemTile({ name, model, effect, actions }: { name: string; model: PaintCell | null; effect: PaintCell | null; actions: CellActions }) {
  return (
    <div className={`paint-tile ${model?.on || effect?.on ? 'on' : ''} ${picked(model, effect) ? 'sel' : ''}`}>
      <Pic layer={model ?? effect} label={name} cls={`paint-pic wide ${effect?.on ? 'fx' : ''} ${model?.on ? 'tinted' : ''}`}
        style={{ ...ring(effect), ...(model?.on ? { '--c': model.color } : {}) } as CSSProperties} actions={actions}>
        <CosThumb name={name} fallback="checkroom" cls="paint-pic-img" />
      </Pic>
      <span className="paint-tile-name" title={name}>{name}</span>
      <span className="paint-chips">
        {model && <Chip cell={model} label={L`Цвет`} actions={actions} />}
        {effect && <Chip cell={effect} label={L`Эффект`} actions={actions} />}
      </span>
    </div>
  );
}

/** The hero's own layers under his stage: his other effects, his icon and portrait, his body. */
export function HeroLayers({ name, picture, effects, portrait, body, actions }: {
  name: string; picture: string | null; effects: PaintCell | null; portrait: PaintCell | null; body: PaintCell | null; actions: CellActions;
}) {
  const shown = useShaded(picture, portrait?.on ? portrait.color : null, portrait?.mode);
  return (
    <div className="paint-hero-row">
      <Pic layer={portrait} label={L`Иконка и портрет`} cls={`paint-portrait ${effects?.on ? 'fx' : ''}`} style={ring(effects)} actions={actions}>
        {shown ? <img src={shown} alt="" draggable={false} /> : <span className="ms">person</span>}
      </Pic>
      <div className="paint-hero-side">
        <span className="paint-hero-name">{name}</span>
        <span className="paint-hero-chips">
          {body && <Chip cell={body} label={L`Тело`} actions={actions} />}
          {effects && <Chip cell={effects} label={L`Атака и прочее`} actions={actions} />}
          {portrait && <Chip cell={portrait} label={L`Иконка и портрет`} actions={actions} />}
        </span>
      </div>
    </div>
  );
}
