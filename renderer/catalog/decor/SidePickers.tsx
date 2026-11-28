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
import { bothSides, onePerName, pickedBoth, pickedOf, sidesFor, type Which } from './sides.ts';

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
    return o ? lookLabel(o.name) : L`как в игре`;
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
  };
  const shown = which === 'both' ? sets : sets.filter((o) => o.sides.includes(which) && o.models[which]);
  const tiles: LookTile[] = [
    ...shown.map((o) => ({ id: o.id, name: o.name, note: L`из игры`, item: treeIcon(m, o.name) })),
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
      {m.oneSize && <span className="opt-slider-step">{L`Карта рисует часть деревьев меньше и поворачивает каждое по-своему. С этим все деревья в полный размер и без поворота: пеньки, кубы и другие моды из одной модели встают по квадратам карты. Где деревья стоят и что загораживают, не меняется`}</span>}
      <span className="opt-slider-step">
        {m.modTreeNote ?? (none ? L`В этом моде нет деревьев, которые видно на карте` : L`Наборы деревьев из игры, свои на каждой стороне, и моды из каталога. Мод скачивается, как при установке`)}
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
