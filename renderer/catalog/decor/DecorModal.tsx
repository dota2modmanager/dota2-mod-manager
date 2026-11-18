/* Two windows over one 3D map, laid out as the hero builder is: the game's whole map on the left
 * (map-view.ts), lit as the game lights it, and on the right what the window changes.
 * "Своя карта" (kind 'map', MapSide.tsx) makes the map: its terrain, weather, dark look, ground in
 * polygons and trees, built into maps/dota.vpk and a pak of its own (crates/mm-core/src/looks/map_make.rs).
 * "Оптимизация" (kind 'optimize', OptSide.tsx) takes things off whatever map is on: its level of
 * detail and sliders (crates/mm-core/src/looks/map_decor.rs, map_optimize.rs). Each is a record of its own. */
import { useEffect, useRef, useState } from 'react';
import type { DecorGroup, DecorSample, MapKind, MapOption } from '../../api/content.ts';
import type { TerrainPaint, ZoneLight } from '../../api/decor.ts';
import type { GroundLook, MapLooks } from './map-view.ts';
import { mapOf } from './pickers.tsx';
import { stemOf } from './map-names.ts';
import { LOOK_GROUPS, type LevelId, type SliderId } from './levels.ts';
import { OptSide } from './OptSide.tsx';
import { MapSide } from './MapSide.tsx';

export interface DecorModalModel {
  /** which of the two windows: the map of one's own, or Optimization */
  kind: 'map' | 'optimize';
  /** Optimization's groups; in the map's window its dark look, "dusk" or "dark" */
  groups: DecorGroup[];
  /** the groups taken out now, or null when nothing is */
  installed: DecorGroup[] | null;
  /** how many of the game's files each group takes on this map, or null before the map is read */
  counts: Partial<Record<DecorGroup, number>> | null;
  /** what each group takes on this map: its materials (for the 3D map), the trees it swaps, effects */
  samples: Partial<Record<DecorGroup, DecorSample>> | null;
  /** the game's own tree and tower sets (Trees and Towers from the game): what there is, what is picked per side, what is on */
  looks: { options: Record<MapKind, MapOption[]>; chosen: Record<MapKind, Sides>; installed: Record<MapKind, Sides> } | null;
  /** the dark look of the map on now ("dusk", "dark"), which Optimization's 3D map draws */
  installedDark: DecorGroup[];
  /** whether the map of one's own is on (its window says "Обновить") */
  installedAny: boolean;
  /** the ground in polygons, picked and on now */
  groundFacets: 'small' | 'large' | null;
  installedGroundFacets: 'small' | 'large' | null;
  /** the game's terrain items (Winter Terrain...), each with the map it brings, and the catalog's terrains */
  terrains: { id: string; name: string; map: string }[];
  catalogTerrains: { name: string; file: string; preview?: string }[];
  /** what the picked catalog terrain is, once read: a whole map, or a pak whose materials go on the default one */
  terrainLook: { kind: 'map' } | TerrainPaint | null;
  /** the terrain item picked (null: the default map), and the one on now */
  terrain: string | null;
  installedTerrain: string | null;
  /** the game's weather items (Weather Rain...), each with its key ("snow"); the key picked and on now */
  weathers: { id: string; name: string; key: string }[];
  weather: string | null;
  installedWeather: string | null;
  /** the catalog's Trees mods, the one picked (its file) and the one on now */
  catalogTrees: { name: string; file: string; preview?: string }[];
  modTree: string | null;
  installedModTree: string | null;
  /** the tree models the picked mod brings, null until they are read; a note while they are fetched */
  modTreeModels: string[] | null;
  modTreeNote: string | null;
  /** the light of the everyday zone and of each weather, as the game's zones have it */
  weatherLight: Record<string, ZoneLight> | null;
  /** the map that is on, for Optimization to say what it builds on: its name, null for the default one */
  mapName: string | null;
  busy: boolean;
}

/** A set picked per side by its id, null for the game's own. */
export type Sides = Record<'radiant' | 'dire', string | null>;

export interface DecorModalActions {
  close: () => void;
  step: (id: SliderId, step: number) => void;
  level: (id: LevelId) => void;
  look: (kind: MapKind, side: 'radiant' | 'dire', id: string | null) => void;
  groundFacets: (f: 'small' | 'large' | null) => void;
  terrain: (id: string | null) => void;
  weather: (id: string | null) => void;
  modTree: (file: string | null) => void;
  install: () => void;
}

function MapStage({ samples, groups, looks, ground, map, paint, weather, lights }: { samples: Partial<Record<DecorGroup, DecorSample>>; groups: DecorGroup[]; looks: MapLooks; ground: GroundLook; map: string | null; paint: TerrainPaint | null; weather: string | null; lights: Record<string, ZoneLight> | null }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<import('./map-view.ts').MapView | null>(null);
  // a failure is not still working: it shows without the spinner
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  useEffect(() => {
    let gone = false;
    void import('./map-view.ts').then(async ({ mountMapView }) => {
      if (gone || !host.current) return;
      const v = await mountMapView(host.current, samples, map, (t, failed) => { if (!gone) setNote(t ? { text: t, failed: !!failed } : null); });
      if (gone) { v.dispose(); return; }
      view.current = v;
      v.show(new Set(groups), looks, ground);
      v.paint(paint);
      v.weather(weather, lights);
    });
    return () => { gone = true; view.current?.dispose(); view.current = null; };
    // the map loads once per window; the groups only switch what shows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, map]);
  useEffect(() => { view.current?.show(new Set(groups), looks, ground); }, [groups, looks, ground.map, ground.facets]);
  useEffect(() => { view.current?.paint(paint); }, [paint]);
  useEffect(() => { view.current?.weather(weather, lights); }, [weather, lights]);
  return (
    <div className="opt-map" ref={host}>
      {note && <div className="opt-map-note"><span className="ms">{note.failed ? 'error' : 'progress_activity'}</span>{note.text}</div>}
      <span className="opt-map-hint">{L`Мышью: крутить, приближать, двигать (правая кнопка)`}</span>
    </div>
  );
}

/** The models the 3D map stands for the sets picked, per side. */
function looksOf(m: DecorModalModel): MapLooks {
  const pick = (kind: MapKind) => {
    const out: MapLooks['trees'] = {};
    for (const side of ['radiant', 'dire'] as const) {
      const id = m.looks?.chosen[kind][side];
      const model = id ? m.looks?.options[kind].find((o) => o.id === id)?.models[side] : undefined;
      if (model) out[side] = model;
    }
    return out;
  };
  // a catalog mod's trees stand where the game's tree of the same name stood
  const mod: Record<string, string> = {};
  if (m.modTree) for (const model of m.modTreeModels ?? []) mod[stemOf(model)] = `mod:${m.modTree}|${model}`;
  return { trees: pick('trees'), mod };
}

export function DecorModal({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  const same = m.installed !== null && m.installed.length === m.groups.length && m.groups.every((g) => m.installed?.includes(g));
  // the sets picked are mods of their own: a changed one is something to put on as well
  const groundSame = m.terrain === m.installedTerrain && m.weather === m.installedWeather && m.groundFacets === m.installedGroundFacets;
  const setsSame = groundSame && m.modTree === m.installedModTree
    && (!m.looks || (['trees', 'towers'] as MapKind[]).every((k) => m.looks!.chosen[k].radiant === m.looks!.installed[k].radiant && m.looks!.chosen[k].dire === m.looks!.installed[k].dire));
  const isMap = m.kind === 'map';
  // Optimization's terrain is the one on (decor.ts), the map's window's the one being made
  const map = mapOf(m);
  const paint = m.terrainLook?.kind === 'pak' ? m.terrainLook : null;
  const weather = isMap ? m.weather : (m.groups.includes('weather') ? null : m.installedWeather);
  // the dark look is the map's: Optimization draws the one on, beside the groups it takes out
  const shown = isMap ? m.groups : [...m.groups.filter((g) => !LOOK_GROUPS.includes(g)), ...m.installedDark];
  const nothing = isMap ? !m.groups.length && !m.terrain && !m.weather && !m.groundFacets : !m.groups.length;
  const unchanged = isMap ? same && setsSame : same;
  return (
    <div className="modal-body wardrobe opt">
      <div className="ward-head">
        <div className="modal-title">{isMap ? L`Своя карта` : L`Оптимизация`}</div>
        <span className="ward-state">{L`Видно это только тебе`}</span>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="opt-body">
        {m.samples ? <MapStage key={map ?? 'dota'} samples={m.samples} groups={shown} looks={looksOf(m)} ground={{ map: null, facets: m.groundFacets }} map={map} paint={paint} weather={weather} lights={m.weatherLight} /> : <div className="opt-map" />}
        <aside className="opt-side">
          {isMap ? <MapSide m={m} actions={actions} /> : <OptSide m={m} actions={actions} />}
          <div className="opt-actions">
            {m.busy
              ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
              : <button className="btn btn-primary" id="decorInstallBtn" disabled={(nothing && !(isMap && !setsSame)) || unchanged} onClick={actions.install}>
                <span className="ms">download</span>{(isMap ? m.installedAny : m.installed) ? L`Обновить` : L`Поставить`}
              </button>}
            <div className="modal-note">
              {isMap
                ? L`Карта собирается из файлов игры и ставится одним модом в «Моих модах». Оптимизация, если стоит, пересобирается на новой карте.`
                : L`Список берётся из карты, которая стоит, и файлов игры при каждой сборке, а после обновления Доты приложение соберёт его заново. Чтобы всё вернуть, выключи или удали мод в «Моих модах».`}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
