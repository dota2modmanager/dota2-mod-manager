/**
 * Source 2 exports bodygroup alternatives as independent glTF nodes. VRF doesn't
 * carry their game-side bodygroup visibility into glTF: *_copy, *_alt and the
 * first-style mesh can consequently all be drawn on top of one another.
 *
 * This is deliberately conservative. We only hide meshes when a model contains
 * an explicit pair of primary and _alt materials on separate primitives. Models
 * without that pair, including unrelated copy-named components, remain untouched.
 */
import { readGlb, writeGlb } from './glb-embed.ts';

type Primitive = { material?: number };
type Mesh = { name?: string; primitives?: Primitive[] };
type Node = { name?: string; mesh?: number };
type Material = { name?: string };
type StyledGlb = { meshes?: Mesh[]; nodes?: Node[]; materials?: Material[] };

const norm = (name: string) => name.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
const bare = (name: string) => name.replace(/_alt$/i, '').toLowerCase();

/** Keep only the first or alternative authored mesh for a model with an alternate bodygroup. */
export function selectStyleMeshes(data: Uint8Array, style = 0): Buffer {
  const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const { json, bin } = readGlb(input);
  const gltf = json as unknown as StyledGlb;
  const materials = (gltf.materials ?? []).map(m => norm(m.name ?? ''));
  const names = new Set(materials);
  const paired = new Set(materials.filter(m => /_alt$/.test(m) && names.has(bare(m))).map(bare));
  if (!paired.size) return input;

  const category = (mesh: Mesh): 'base' | 'alt' | 'copy' | null => {
    const assigned = (mesh.primitives ?? []).map(p => materials[p.material ?? -1] ?? '');
    const relevant = assigned.filter(m => paired.has(bare(m)));
    // Mixed geometry may include accents shared by both styles; do not hide it.
    if (!relevant.length || relevant.length !== assigned.length) return null;
    const alt = relevant.every(m => /_alt$/.test(m));
    const base = relevant.every(m => !/_alt$/.test(m));
    if (!base && !alt) return null;
    if (/_copy(?:\d+)?$/i.test(norm(mesh.name ?? ''))) return 'copy';
    return alt ? 'alt' : 'base';
  };

  const selected = style > 0 ? 'alt' : 'base';
  let changed = false;
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = gltf.meshes?.[node.mesh];
    if (!mesh) continue;
    const group = category(mesh);
    if (group && group !== selected) { delete node.mesh; changed = true; }
  }
  return changed ? writeGlb(json, bin) : input;
}

/** A style chosen on a set's head also controls the exported alt meshes on its siblings. */
export function syncArcanaStyles<T extends { model: string; style?: number; explicitBaseStyle?: boolean }>(parts: T[]): void {
  const family = (model: string) => /^models\/items\/[^/]+\/[^/]+\//.exec(model)?.[0] ?? '';
  const chosen = new Map<string, number>();
  for (const part of parts) if (part.style && family(part.model)) chosen.set(family(part.model), part.style);
  for (const part of parts) if (!part.style && !part.explicitBaseStyle && chosen.has(family(part.model))) {
    part.style = chosen.get(family(part.model));
  }
}

/** Only multi-piece items from the same authored collection inherit a selected style. */
export function styleFamily(model: string): string {
  return /^models\/items\/[^/]+\/[^/]+\//i.exec(model.replace(/\\/g, '/'))?.[0].toLowerCase() ?? '';
}

/** Exported cinematic-only geometry is not part of the normal hero idle.
 * Spectre's arcana has five landing-page dissolve blades which VRF exports as
 * regular GLB nodes: in the inventory they appear as huge flat white shards.
 * The material name is an explicit opt-in, not a broad 'hide extra meshes' rule. */
export function hidePreviewOnlyMeshes(data: Uint8Array): Buffer {
  const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const {json,bin}=readGlb(input);
  const gltf=json as unknown as StyledGlb;
  const materials=(gltf.materials??[]).map(m=>String(m.name??'').toLowerCase());
  let changed=false;
  for(const node of gltf.nodes??[]){
    if(node.mesh===undefined)continue;
    const mesh=gltf.meshes?.[node.mesh];
    const assigned=(mesh?.primitives??[]).map(p=>materials[p.material??-1]??'');
    if(assigned.length && assigned.every(m=>/(?:^|[\\/_.-])landing_page[\w-]*.*(?:dissolve|blade)|landing_page_blade_dissolve/.test(m))){
      delete node.mesh;changed=true;
    }
  }
  return changed?writeGlb(json,bin):input;
}
