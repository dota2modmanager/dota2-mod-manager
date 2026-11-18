/* The pickers of the window "Своя карта" (MapSide.tsx), of whole looks rather than of how much to
 * take out: the catalog's terrain, the game's weather, the ground in polygons, and the trees (the
 * game's own sets and the catalog's Trees mods). Each is put on with the map, or as a mod of its own. */
import type { DecorModalActions, DecorModalModel } from './DecorModal.tsx';
import { previewUrl } from '../../ui/media.ts';
import { LookTiles } from './LookTiles.tsx';

/** The map the window loads: a catalog terrain that is a whole map ("catalog:Winter.zip"); a pak of
 * materials and the default map are the default map, the pak put on it in place. */
export const mapOf = (m: DecorModalModel): string | null => (m.terrainLook?.kind === 'map' ? m.terrain : null);

export function TerrainPicker({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  return (
    <div className={`opt-slider ${m.terrain ? 'active' : ''}`}>
      <div className="opt-slider-head"><b>{L`Ландшафт`}</b></div>
      <LookTiles label={L`Ландшафт`} value={m.terrain} onPick={actions.terrain} wide
        tiles={[
          ...m.catalogTerrains.map((t) => ({ id: `catalog:${t.file}`, name: t.name, picture: previewUrl('terrains', t.preview) })),
        ]} />
      <span className="opt-slider-step">{L`Целая карта берётся основой; ландшафт из материалов ложится на стандартную. Погода и всё остальное строятся на ней`}</span>
    </div>
  );
}

/** The ground in polygons, the "low poly" look: each picture as flat triangles of its own colours. */
export function GroundStylePicker({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  return (
    <div className={`opt-slider ${m.groundFacets ? 'active' : ''}`}>
      <div className="opt-slider-head"><b>{L`Лоу-поли земля`}</b></div>
      <div className="opt-levels opt-levels-3" role="radiogroup" aria-label={L`Лоу-поли земля`}>
        {([[null, L`Как в игре`], ['large', L`Крупные`], ['small', L`Мелкие`]] as const).map(([id, name]) => (
          <button key={id ?? ''} role="radio" aria-checked={m.groundFacets === id} className={`opt-level ${m.groundFacets === id ? 'active' : ''}`}
            onClick={() => actions.groundFacets(id)}>{name}</button>
        ))}
      </div>
      <span className="opt-slider-step">{L`Земля плоскими треугольниками своих же цветов. Нужны Workshop Tools: картинки собирает компилятор Valve`}</span>
    </div>
  );
}

/** The game's weather, written into the map the build makes (map_build.rs). */
export function WeatherPicker({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  return (
    <div className={`opt-slider ${m.weather ? 'active' : ''}`}>
      <div className="opt-slider-head"><b>{L`Погода`}</b></div>
      <LookTiles label={L`Погода`} value={m.weather} onPick={actions.weather}
        tiles={m.weathers.map((w) => ({ id: w.key, name: w.name.replace(/^Weather[:\s-]*/i, ''), item: w.name }))} />
      <span className="opt-slider-step">{L`Погода записывается в саму карту, со своим светом и туманом`}</span>
      {/* the 3D map plays the game's systems, but not as the game draws them: no fog of war, no soft edges, no wind */}
      <span className="opt-note"><span className="ms">info</span>{L`В 3D погода показана примерно. Как она выглядит на самом деле, смотрите в игре.`}</span>
    </div>
  );
}
