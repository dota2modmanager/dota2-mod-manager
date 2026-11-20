/* What the recolour window decides without drawing (views/hero-paint.ts): which layers are pictures
 * and so take a mode, what a layer, a part or a zone is called, what each key would send, and what
 * the editor shows. A key is a layer, or a part of a model layer and a colour zone of its texture
 * (catalog/paint/paint-recipe.ts). */
import type { PaintLayer, PaintPartPicture } from '../api/content.ts';
import type { PaintEditorModel } from '../catalog/paint/PaintEditor.tsx';
import type { PaintMode } from '../catalog/paint/paint-mode.ts';
import { keyOf, lookValue, NO_MATS, partName, splitKey, ZONES, type Look, type Zone } from '../catalog/paint/paint-recipe.ts';

/** A layer drawn from a picture or a texture: the modes apply to it. Particles take the colour alone. */
export const isPicture = (l: Pick<PaintLayer, 'kind'>): boolean => l.kind === 'abilityIcon' || l.kind === 'portrait' || l.kind === 'body' || l.kind === 'itemModel';

/** A layer drawn from a model's textures: it has parts, zones and a material. */
export const isModel = (l: Pick<PaintLayer, 'kind'>): boolean => l.kind === 'body' || l.kind === 'itemModel';

export function layerLabel(l: PaintLayer): string {
  if (l.kind === 'effects') return L`атака и прочее`;
  if (l.kind === 'portrait') return L`портрет`;
  if (l.kind === 'body') return L`тело`;
  if (l.kind === 'abilityIcon') return L`иконка ${l.name || ''}`;
  if (l.kind === 'itemModel') return L`цвет ${l.name || ''}`;
  if (l.kind === 'item') return L`эффект ${l.name || ''}`;
  return l.name || l.id;
}

/** A colour zone's name. */
export function zoneLabel(z: Zone): string {
  switch (z) {
    case 'dark': return L`Тёмное`;
    case 'light': return L`Серое и металл`;
    case 'red': return L`Красное`;
    case 'orange': return L`Оранжевое и кожа`;
    case 'yellow': return L`Жёлтое и золото`;
    case 'green': return L`Зелёное`;
    case 'cyan': return L`Бирюзовое`;
    case 'blue': return L`Синее`;
    default: return L`Фиолетовое`;
  }
}

/** A key's name: its layer's, then its part and zone. */
export function keyLabel(layers: readonly PaintLayer[], key: string): string {
  const k = splitKey(key);
  const layer = layers.find((l) => l.id === k.layer);
  return [layer ? layerLabel(layer) : k.layer, k.part ? partName(k.part) : null, k.zone ? zoneLabel(k.zone).toLowerCase() : null].filter(Boolean).join(' · ');
}

/** The layers on, by name, for the line at the foot: four, then how many more. */
export const paintSummary = (named: string[]): string => (named.length ? named.slice(0, 4).join(', ') + (named.length > 4 ? ` +${named.length - 4}` : '') : '');

/** The window's state as far as the editor reads it. */
export interface EditorSource {
  layers: PaintLayer[];
  /** the keys on: layers, and parts and zones of model layers */
  on: ReadonlySet<string>;
  /** by key; a layer without one takes the window's colour and mode */
  looks: ReadonlyMap<string, Look>;
  all: string;
  allMode: PaintMode;
  selected: string | null;
  gems: { key: string; name: string; hex: string }[];
  /** the model's textures as pictures with their zones, by file, as they come */
  pictures: Readonly<Record<string, PaintPartPicture>>;
}

const GREY = '#8a8a8a';

/** What a key gives now: its own look, or for a layer the window's colour. A part or zone has no colour of its own until one is picked. */
export function lookOf(st: Pick<EditorSource, 'layers' | 'looks' | 'all' | 'allMode'>, key: string): Look {
  const own = st.looks.get(key);
  if (own) return own;
  const k = splitKey(key);
  if (k.part || k.zone) return { hex: null, mode: 'full', mats: [...NO_MATS] };
  const layer = st.layers.find((l) => l.id === key);
  return { hex: st.all, mode: layer && isPicture(layer) ? st.allMode : 'tint', mats: [...NO_MATS] };
}

/** The values the button would put on: one per key that is on, of a layer the hero has. */
export function wantedValues(st: Pick<EditorSource, 'layers' | 'on' | 'looks' | 'all' | 'allMode'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of st.on) {
    const k = splitKey(key);
    const layer = st.layers.find((l) => l.id === k.layer);
    if (!layer || ((k.part || k.zone) && !isModel(layer))) continue;
    const look = lookOf(st, key);
    const v = lookValue(isPicture(layer) ? look : { hex: look.hex, mode: 'tint', mats: [...NO_MATS] });
    if (v) out[key] = v;
  }
  return out;
}

/** The editor for the key picked, or for every layer that is on when none is (or the one picked is gone). */
export function editorOf(st: EditorSource): PaintEditorModel {
  const key = st.selected ? splitKey(st.selected) : null;
  const layer = key ? st.layers.find((l) => l.id === key.layer) : undefined;
  if (!key || !layer || !st.selected) return { id: null, title: L`Все включённые`, color: st.all, mode: st.allMode, picture: true, on: st.on.size > 0, gems: st.gems, keep: false };
  const picture = isPicture(layer);
  const own = layer.kind === 'body' ? L`Тело` : layer.kind === 'portrait' ? L`Иконка и портрет` : layer.kind === 'effects' ? L`Атака и прочее` : null;
  const part = layer.kind === 'itemModel' ? L`цвет` : layer.kind === 'abilityIcon' ? L`иконка` : layer.kind === 'item' || layer.kind === 'ability' ? L`эффект` : null;
  const look = lookOf(st, st.selected);
  const sub = !!(key.part || key.zone);
  const m: PaintEditorModel = {
    id: st.selected,
    title: [own ?? `${layer.name || layer.id}${part ? ` · ${part}` : ''}`, key.part ? partName(key.part) : null, key.zone ? zoneLabel(key.zone) : null].filter(Boolean).join(' · '),
    color: look.hex ?? GREY,
    keep: !look.hex,
    to: look.to ?? undefined,
    at: look.at ?? undefined,
    mode: picture ? look.mode : 'tint',
    picture,
    on: st.on.has(st.selected),
    gems: st.gems,
    sub,
    // the items it shares a texture with, which take its colour too
    ...(layer.shares?.length && !sub ? { shared: layer.shares.map((id) => st.layers.find((l) => l.id === id)?.name || id).join(', ') } : {}),
  };
  if (!isModel(layer)) return m;
  const painted = (pred: (k: ReturnType<typeof splitKey>) => boolean) => [...st.on].some((x) => { const k = splitKey(x); return k.layer === layer.id && pred(k); });
  const parts = layer.parts ?? [];
  const files = key.part ? parts.filter((p) => p.id === key.part).map((p) => p.file) : parts.map((p) => p.file);
  // the zones of the textures in view: the largest share each has in any of them
  const zones = new Map<string, { share: number; hex: string }>();
  for (const f of files) for (const [z, share, hex] of st.pictures[f]?.zones ?? []) if ((zones.get(z)?.share ?? -1) < share) zones.set(z, { share, hex });
  m.model = {
    part: key.part,
    zone: key.zone,
    parts: parts.map((p) => ({ id: p.id, name: partName(p.id), picture: st.pictures[p.file]?.picture || null, painted: painted((k) => k.part === p.id) })),
    zones: ZONES.filter((z) => zones.has(z) || z === key.zone).map((z) => ({
      zone: z, name: zoneLabel(z), hex: zones.get(z)?.hex ?? GREY, share: zones.get(z)?.share ?? 0, painted: painted((k) => k.zone === z && k.part === key.part),
    })),
    loading: files.some((f) => !st.pictures[f]),
    mats: look.mats,
    masks: !parts.length || parts.some((p) => p.masks && (!key.part || p.id === key.part)),
  };
  return m;
}

/** The key the editor moves to when a part or a zone is picked in it (null: the whole). */
export const moveKey = (selected: string, change: { part?: string | null; zone?: Zone | null }): string => {
  const k = splitKey(selected);
  return keyOf(k.layer, change.part === undefined ? k.part : change.part, change.zone === undefined ? k.zone : change.zone);
};
