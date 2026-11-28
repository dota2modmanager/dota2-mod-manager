/* Trees and towers in the window "Своя карта", each side of its own: the game's own sets (Autumn,
 * Spring, a tower set of an event...) picked for both sides at once or for Radiant or Dire alone,
 * and for trees the catalog's Trees mods, which change every tree of the map. Each set picked is a
 * mod of its own (map_looks_service.rs), put on with the map. These were two Workshop windows of
 * their own (catalog/map/MapLookModal.tsx), which the catalog's cards still open. */
import { useState } from 'react';
import type { MapKind, MapOption } from '../../api/content.ts';
import type { DecorModalActions, DecorModalModel, Sides } from './DecorModal.tsx';
import { previewUrl } from '../../ui/media.ts';
import { lookLabel } from '../map/MapLookModal.tsx';
import { LookTiles, type LookTile } from './LookTiles.tsx';
import { BLOCKS, bothSides, onePerName, pickedBoth, pickedOf, sidesFor, type Which } from './sides.ts';

/** The blocks' tile: hedge squares on the grass, a path between them. */
const BLOCKS_PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="#6b7f3a"/>'
  + '<rect x="0" y="34" width="120" height="14" fill="#a38a5a"/>'
  + [[6, 6], [26, 6], [46, 6], [86, 6], [6, 52], [46, 52], [66, 52], [86, 52], [106, 52]].map(([x, y]) =>
    `<rect x="${x}" y="${y}" width="18" height="22" fill="#3f6a2c" stroke="#2f5622"/>`).join('')
  + '</svg>')}`;

const MOD = 'mod:';

/** The sets of a kind that have a model on at least one side. */
const setsOf = (m: DecorModalModel, kind: MapKind): MapOption[] =>
  m.looks?.options[kind].filter((o) => o.models.radiant || o.models.dire) ?? [];

function SideSwitch({ which, onWhich, label }: { which: Which; onWhich: (w: Which) => void; label: string }) {
  const opts: [Which, string][] = [['both', L`Обе стороны`], ['radiant', L`Свет`], ['dire', L`Тьма`]];
  return (
    <div className="opt-levels opt-levels-3 opt-sides" role="radiogroup" aria-label={label}>
      {opts.map(([id, name]) => (
        <button key={id} role="radio" aria-checked={which === id} className={`opt-level ${which === id ? 'active' : ''}`} onClick={() => onWhich(id)}>{name}</button>
      ))}
    </div>
  );
}

/** "Radiant: Autumn · Dire: as in the game" under the tiles. */
function SidesLine({ m, kind, chosen, mod }: { m: DecorModalModel; kind: MapKind; chosen: Sides | undefined; mod?: string | null }) {
  if (mod) return null;
  const name = (id: string | null | undefined) => {
    const o = id ? m.looks?.options[kind].find((x) => x.id === id) : undefined;
    return o ? (o.id === BLOCKS ? L`Квадраты` : lookLabel(o.name)) : L`как в игре`;
  };
  return <span className="opt-sides-line">{L`Свет: ${name(chosen?.radiant)} · Тьма: ${name(chosen?.dire)}`}</span>;
}

function setLook(actions: DecorModalActions, kind: MapKind, was: Sides | undefined, next: Sides): void {
  for (const side of ['radiant', 'dire'] as const) if ((was?.[side] ?? null) !== next[side]) actions.look(kind, side, next[side]);
}

/** A tree set's picture: a set of a map (Autumn) wears that map's terrain icon. */
const treeIcon = (m: DecorModalModel, name: string) => m.terrains.find((t) => t.map === name.toLowerCase())?.name ?? null;

export function TreesPicker({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  const [which, setWhich] = useState<Which>('both');
  const sets = setsOf(m, 'trees');
  const chosen = m.looks?.chosen.trees;
  const value = m.modTree ? MOD + m.modTree : pickedOf(chosen, which);
  const pick = (id: string | null) => {
    const file = id?.startsWith(MOD) ? id.slice(MOD.length) : null;
    // a catalog mod changes every tree of the map: the sets come off both sides
    const next = file ? { radiant: null, dire: null } : sidesFor(sets.find((o) => o.id === id), file ? 'both' : which, chosen ?? { radiant: null, dire: null });
    setLook(actions, 'trees', chosen, next);
    if (file !== m.modTree) actions.modTree(file);
    // the blocks are the grid's squares only with the trees straight and of one size
    if (id === BLOCKS && !m.oneSize) actions.oneSize(true);
  };
  const shown = which === 'both' ? sets : sets.filter((o) => o.sides.includes(which) && o.models[which]);
  const tiles: LookTile[] = [
    ...shown.map((o) => (o.id === BLOCKS
      ? { id: o.id, name: L`Квадраты`, note: L`новые`, picture: BLOCKS_PICTURE }
      : { id: o.id, name: o.name, note: L`из игры`, item: treeIcon(m, o.name) })),
    ...(which === 'both' ? m.catalogTrees.map((t) => ({ id: MOD + t.file, name: t.name, note: L`из каталога`, picture: previewUrl('trees', t.preview) })) : []),
  ];
  const none = m.modTree && m.modTreeModels && !m.modTreeModels.length;
  return (
    <div className={`opt-slider ${value || chosen?.radiant || chosen?.dire ? 'active' : ''}`}>
      <div className="opt-slider-head"><b>{L`Деревья`}</b></div>
      <SideSwitch which={which} onWhich={setWhich} label={L`Деревья`} />
      <LookTiles label={L`Деревья`} value={value} onPick={pick} wide tiles={tiles} />
      <SidesLine m={m} kind="trees" chosen={chosen} mod={m.modTree} />
      <label className="opt-check">
        <input type="checkbox" className="lib-check" checked={m.oneSize} onChange={(e) => actions.oneSize(e.currentTarget.checked)} />
        <span>{L`Все деревья одного размера и ровно`}</span>
      </label>
      {m.oneSize && <span className="opt-slider-step">{L`Карта рисует часть деревьев меньше и поворачивает каждое по-своему. С этим все деревья в полный размер и без поворота: пеньки, квадраты и другие моды из одной модели встают по квадратам карты. Где деревья стоят и что загораживают, не меняется`}</span>}
      <span className="opt-slider-step">
        {m.modTreeNote ?? (none ? L`В этом моде нет деревьев, которые видно на карте`
          : chosen?.radiant === BLOCKS || chosen?.dire === BLOCKS
            ? L`Квадраты: каждое дерево становится низкой изгородью ровно в квадрат 2×2 клетки, который оно загораживает. Видно, где можно пройти, а где нет. Деревья встают ровно и одного размера. Нужны Workshop Tools`
            : L`Наборы деревьев из игры, свои на каждой стороне, и моды из каталога. Мод скачивается, как при установке`)}
      </span>
    </div>
  );
}

export function TowersPicker({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  const [which, setWhich] = useState<Which>('both');
  const sets = setsOf(m, 'towers');
  const chosen = m.looks?.chosen.towers;
  const name = (o: MapOption) => lookLabel(o.name);
  const pick = (id: string | null) => setLook(actions, 'towers', chosen,
    which === 'both' ? bothSides(sets, name, id) : sidesFor(sets.find((o) => o.id === id), which, chosen ?? { radiant: null, dire: null }));
  const shown = which === 'both' ? onePerName(sets, name) : sets.filter((o) => o.sides.includes(which) && o.models[which]);
  return (
    <div className={`opt-slider ${chosen?.radiant || chosen?.dire ? 'active' : ''}`}>
      <div className="opt-slider-head"><b>{L`Башни`}</b></div>
      <SideSwitch which={which} onWhich={setWhich} label={L`Башни`} />
      <LookTiles label={L`Башни`} value={which === 'both' ? pickedBoth(sets, name, chosen) : pickedOf(chosen, which)} onPick={pick}
        tiles={shown.map((o) => ({ id: o.id, name: lookLabel(o.name), item: o.name }))} />
      <SidesLine m={m} kind="towers" chosen={chosen} />
      <span className="opt-slider-step">{L`Башни любого события игры, свои у Света и у Тьмы`}</span>
    </div>
  );
}
