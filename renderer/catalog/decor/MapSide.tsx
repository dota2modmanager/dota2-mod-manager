/* The side of the window "Своя карта": what the map is made of. Its terrain (a catalog map as the
 * base, or a pak of materials over the default one), the game's weather, the dark look, the ground
 * in polygons, the trees and the towers, a side each; all of it built into maps/dota.vpk and a pak of its own
 * (crates/mm-core/src/looks/map_make.rs), the trees and towers put on as mods of their own. */
import type { DecorModalActions, DecorModalModel } from './DecorModal.tsx';
import { GroundStylePicker, TerrainPicker, WeatherPicker } from './pickers.tsx';
import { TowersPicker, TreesPicker } from './SidePickers.tsx';
import { DARK, Slider } from './OptSide.tsx';

export function MapSide({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  return (
    <>
      {m.catalogTerrains.length > 0 && <TerrainPicker m={m} actions={actions} />}
      {m.weathers.length > 0 && <WeatherPicker m={m} actions={actions} />}
      <Slider s={DARK} m={m} actions={actions} />
      <GroundStylePicker m={m} actions={actions} />
      {(m.looks || m.catalogTrees.length > 0) && <TreesPicker m={m} actions={actions} />}
      {m.looks && m.looks.options.towers.length > 0 && <TowersPicker m={m} actions={actions} />}
    </>
  );
}
