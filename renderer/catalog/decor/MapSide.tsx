/* The side of the window "Своя карта": what the map is made of. Its terrain (a catalog map as the
 * base, or a pak of materials over the default one), the game's weather, the dark look, the ground
 * in polygons and the trees; all of it built into maps/dota.vpk and a pak of its own
 * (crates/mm-core/src/looks/map_make.rs), the trees put on as mods of their own. */
import type { DecorModalActions, DecorModalModel } from './DecorModal.tsx';
import { GroundStylePicker, TerrainPicker, TreesPicker, WeatherPicker } from './pickers.tsx';
import { DARK, Slider } from './OptSide.tsx';

export function MapSide({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  return (
    <>
      {m.catalogTerrains.length > 0 && <TerrainPicker m={m} actions={actions} />}
      {m.weathers.length > 0 && <WeatherPicker m={m} actions={actions} />}
      <Slider s={DARK} m={m} actions={actions} />
      <GroundStylePicker m={m} actions={actions} />
      {(m.looks || m.catalogTrees.length > 0) && <TreesPicker m={m} actions={actions} />}
    </>
  );
}
