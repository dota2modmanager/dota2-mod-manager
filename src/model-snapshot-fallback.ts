/**
 * Last-resort particle snapshot for assets whose .vsnap is absent from the
 * installed archive (notably PA's arcana weapon surfaces). An approximation
 * from the *actual* skinned GLB is preferable to dropping every particle that
 * samples that snapshot. Never replace a real .vsnap or invent an arbitrary
 * free-floating point in space.
 */
import { readGlb } from './glb-embed.ts';

type Accessor = { bufferView?: number; byteOffset?: number; componentType?: number; type?: string; count?: number; normalized?: boolean };
type View = { byteOffset?: number; byteStride?: number; byteLength?: number };
type Weight = [string, number];
type Point = { position: number[]; skinning: Weight[] };

/** Sample skinned geometry when the game archive has no authored particle snapshot. */
export function snapshotFromModel(bytes: Uint8Array, side: 'left' | 'right' | null = null, max = 192): { position: number[][]; skinning: Weight[][] } | null {
  const { json: header, bin } = readGlb(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const json = header as typeof header & {
    accessors?: Accessor[];
    nodes?: { mesh?: number; skin?: number; name?: string }[];
    meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
    skins?: { joints?: number[] }[];
  };
  const accessors = (json.accessors || []) as Accessor[];
  const views = (json.bufferViews || []) as View[];
  const component = (type: number) => type === 5120 || type === 5121 ? 1 : type === 5122 || type === 5123 ? 2 : type === 5125 || type === 5126 ? 4 : 0;
  const read = (index: number | undefined, row: number): number[] => {
    const a = accessors[index ?? -1], view = views[a?.bufferView ?? -1];
    if (!a || !view || !a.type || !a.componentType || row >= (a.count ?? 0)) return [];
    const sizes: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const size = component(a.componentType), width = sizes[a.type] || 0;
    if (!size || !width) return [];
    const base = (view.byteOffset || 0) + (a.byteOffset || 0) + row * (view.byteStride || width * size);
    if (base < 0 || base + width * size > bin.byteLength) return [];
    const d = new DataView(bin.buffer, bin.byteOffset + base, width * size);
    return Array.from({ length: width }, (_, i) => {
      const p = i * size;
      let n = a.componentType === 5126 ? d.getFloat32(p, true)
        : a.componentType === 5125 ? d.getUint32(p, true)
        : a.componentType === 5123 ? d.getUint16(p, true)
        : a.componentType === 5122 ? d.getInt16(p, true)
        : a.componentType === 5121 ? d.getUint8(p) : d.getInt8(p);
      if (a.normalized) n /= a.componentType === 5123 ? 65535 : a.componentType === 5122 ? 32767 : a.componentType === 5121 ? 255 : 127;
      return n;
    });
  };
  const points: Point[] = [];
  const nodes = (json.nodes || []) as { mesh?: number; skin?: number; name?: string }[];
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes?.[node.mesh], skin = json.skins?.[node.skin ?? -1];
    const joints: string[] = (skin?.joints || []).map((index: number) => nodes[index]?.name || '');
    for (const primitive of mesh?.primitives || []) {
      const at = primitive.attributes || {}, pos = accessors[at.POSITION];
      if (!pos?.count) continue;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let v = 0; v < pos.count; v += step) {
        const xyz = read(at.POSITION, v);
        if (xyz.length !== 3 || !xyz.every(Number.isFinite)) continue;
        const indices = read(at.JOINTS_0, v), weights = read(at.WEIGHTS_0, v);
        const skinning: Weight[] = indices.map((index, i): Weight => [joints[index] || '', weights[i] || 0]).filter(([name, w]) => !!name && (w as number) > 0) as Weight[];
        // GLB stores metres and Y-up; native particle snapshots use Source inches and Z-up.
        const position = [xyz[2] / .0254, xyz[0] / .0254, xyz[1] / .0254];
        points.push({ position, skinning });
      }
    }
  }
  const sideRegex = side === 'left' ? /(?:_l$|left|weapon_l)/i : side === 'right' ? /(?:_r$|right|weapon0_0)/i : null;
  const preferred = sideRegex ? points.filter(p => p.skinning.some(([n, w]) => w > .15 && sideRegex.test(n))) : points;
  const sample = preferred.length >= 12 ? preferred : points;
  if (!sample.length) return null;
  const count = Math.min(Math.max(1, max), sample.length), spacing = sample.length / count;
  const selected = Array.from({ length: count }, (_, i) => sample[Math.floor((i + .5) * spacing)]);
  return { position: selected.map(p => p.position), skinning: selected.map(p => p.skinning) };
}
