/* What the recolour window decides without drawing (views/hero-paint.ts): which layers are pictures
 * and so take a mode, what a layer is called, and what its editor shows. */
import type { PaintLayer } from '../api/content.ts';
import type { PaintEditorModel } from '../catalog/paint/PaintEditor.tsx';
import type { PaintMode } from '../catalog/paint/paint-mode.ts';

/** A layer drawn from a picture or a texture: the modes apply to it. Particles take the colour alone. */
export const isPicture = (l: Pick<PaintLayer, 'kind'>): boolean => l.kind === 'abilityIcon' || l.kind === 'portrait' || l.kind === 'body' || l.kind === 'itemModel';

export function layerLabel(l: PaintLayer): string {
  if (l.kind === 'effects') return L`атака и прочее`;
  if (l.kind === 'portrait') return L`портрет`;
  if (l.kind === 'body') return L`тело`;
  if (l.kind === 'abilityIcon') return L`иконка ${l.name || ''}`;
  if (l.kind === 'itemModel') return L`цвет ${l.name || ''}`;
  if (l.kind === 'item') return L`эффект ${l.name || ''}`;
  return l.name || l.id;
}

/** The layers on, by name, for the line at the foot: four, then how many more. */
export const paintSummary = (named: string[]): string => (named.length ? named.slice(0, 4).join(', ') + (named.length > 4 ? ` +${named.length - 4}` : '') : '');

/** The window's state as far as the editor reads it. */
export interface EditorSource {
  layers: PaintLayer[];
  on: ReadonlySet<string>;
  colors: ReadonlyMap<string, string>;
  modes: ReadonlyMap<string, PaintMode>;
  all: string;
  allMode: PaintMode;
  selected: string | null;
  gems: { key: string; name: string; hex: string }[];
}

/** The editor for the layer picked, or for every layer that is on when none is (or the one picked is gone). */
export function editorOf(st: EditorSource): PaintEditorModel {
  const layer = st.selected ? st.layers.find((l) => l.id === st.selected) : undefined;
  if (!layer) return { id: null, title: L`Все включённые`, color: st.all, mode: st.allMode, picture: true, on: st.on.size > 0, gems: st.gems };
  const picture = isPicture(layer);
  const own = layer.kind === 'body' ? L`Тело` : layer.kind === 'portrait' ? L`Иконка и портрет` : layer.kind === 'effects' ? L`Атака и прочее` : null;
  const part = layer.kind === 'itemModel' ? L`цвет` : layer.kind === 'abilityIcon' ? L`иконка` : layer.kind === 'item' || layer.kind === 'ability' ? L`эффект` : null;
  return {
    id: layer.id,
    title: own ?? `${layer.name || layer.id}${part ? ` · ${part}` : ''}`,
    color: st.colors.get(layer.id) || st.all,
    mode: picture ? st.modes.get(layer.id) || st.allMode : 'tint',
    picture,
    on: st.on.has(layer.id),
    gems: st.gems,
  };
}
