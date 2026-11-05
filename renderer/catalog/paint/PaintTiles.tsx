/* The pieces of the recolour window (PaintModal.tsx): a colour well, a layer's switch with its colour,
 * and a tile that shows a part of the hero in the colours it is getting. An icon layer that is on
 * shades the picture as the build will (shade.ts); an effect layer that is on rings it in its colour,
 * since an effect has no picture of its own to shade. */
import type { CSSProperties, ReactNode } from 'react';
import { CosThumb } from '../builder/parts.tsx';
import { useShaded } from './shade.ts';

/** One switch and colour, for one layer. */
export interface PaintCell { id: string; on: boolean; color: string }

export interface CellActions {
  toggle: (id: string) => void;
  color: (id: string, hex: string) => void;
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
    <span className={`paint-chip ${cell.on ? 'on' : ''}`} data-layer={cell.id} style={{ '--c': cell.color } as CSSProperties}>
      <button className="paint-chip-btn" role="switch" aria-checked={cell.on} onClick={() => actions.toggle(cell.id)}>{label}</button>
      <Swatch color={cell.color} label={label} onColor={(hex) => actions.color(cell.id, hex)} cls="sm" />
    </span>
  );
}

const ring = (fx: PaintCell | null): CSSProperties | undefined => (fx?.on ? { '--fx': fx.color } as CSSProperties : undefined);

/**
 * An ability: its icon, shaded while its icon layer is on, ringed while its effect is.
 * @param picture  the icon out of the game, null for none: the glyph stands in
 */
export function AbilityTile({ name, picture, effect, icon, actions }: {
  name: string; picture: string | null; effect: PaintCell | null; icon: PaintCell | null; actions: CellActions;
}) {
  const shown = useShaded(picture, icon?.on ? icon.color : null);
  const on = !!(effect?.on || icon?.on);
  return (
    <div className={`paint-tile ${on ? 'on' : ''}`}>
      <span className={`paint-pic ${effect?.on ? 'fx' : ''}`} style={ring(effect)}>
        {shown ? <img src={shown} alt="" draggable={false} /> : <span className="ms">bolt</span>}
      </span>
      <span className="paint-tile-name" title={name}>{name}</span>
      <span className="paint-chips">
        {effect && <Chip cell={effect} label={L`Эффект`} actions={actions} />}
        {icon && <Chip cell={icon} label={L`Иконка`} actions={actions} />}
      </span>
    </div>
  );
}

/** An item picked for the hero: its picture, ringed while its effects are getting a colour. */
export function ItemTile({ name, cell, actions }: { name: string; cell: PaintCell; actions: CellActions }) {
  return (
    <div className={`paint-tile ${cell.on ? 'on' : ''}`}>
      <span className={`paint-pic wide ${cell.on ? 'fx' : ''}`} style={ring(cell)}>
        <CosThumb name={name} fallback="checkroom" cls="paint-pic-img" />
      </span>
      <span className="paint-tile-name" title={name}>{name}</span>
      <span className="paint-chips"><Chip cell={cell} label={L`Эффект`} actions={actions} /></span>
    </div>
  );
}

/** The hero himself, as the game's hero selection shows him: the portrait shaded while its layer is on, ringed while his effects are. */
export function HeroCard({ name, picture, effects, portrait, body, actions, children }: {
  name: string; picture: string | null; effects: PaintCell | null; portrait: PaintCell | null; body: PaintCell | null;
  actions: CellActions; children?: ReactNode;
}) {
  const shown = useShaded(picture, portrait?.on ? portrait.color : null);
  return (
    <aside className="paint-hero">
      <span className={`paint-portrait ${effects?.on ? 'fx' : ''}`} style={ring(effects)}>
        {shown ? <img src={shown} alt="" draggable={false} /> : <span className="ms">person</span>}
      </span>
      <span className="paint-hero-name">{name}</span>
      <span className="paint-hero-chips">
        {effects && <Chip cell={effects} label={L`Атака и прочее`} actions={actions} />}
        {portrait && <Chip cell={portrait} label={L`Иконка и портрет`} actions={actions} />}
        {body && <Chip cell={body} label={L`Тело`} actions={actions} />}
      </span>
      {children}
    </aside>
  );
}
