/* Names of the map's models, with nothing of the 3D view in them: the decor window reads these
 * before any 3D is asked for, and importing them from map-trees.ts carried three.js, its glTF
 * loader and the mesh merger into the code every start of the app has to compile. */

/** "models/props_tree/dire_tree004.vmdl" as "dire_tree004". */
export const stemOf = (path: string): string => (path.split('/').pop() || '').replace(/\.vmdl(_c)?$/, '').toLowerCase();
