import { embedGlb, readGlb, writeGlb } from './glb-embed.ts';
import type { Attachment } from './particle-spec.ts';
import { itemActivities } from './model-loadout.ts';
import { findItem, itemFields } from './schema.ts';

type CrestGlb = ReturnType<typeof readGlb>['json'] & {
  meshes?: { primitives: { material?: number }[] }[];
  materials?: unknown[];
  samplers?: unknown[];
  textures?: unknown[];
  extras?: unknown;
  extensionsUsed?: string[];
};

/** The distinct golden model path to try for the regular Crest's preview. */
export function goldenCrestModel(text: string, model: string, itemId: string): string | undefined {
  if (itemId !== '6646') return undefined;
  const gold = findItem(text, '6916');
  const donor = gold && itemFields(text, gold).get('model_player')?.toLowerCase();
  return donor && donor !== model ? donor : undefined;
}

/** Use the same authored animation modifiers for both finishes of the same helmet. */
export function crestActivities(text: string, itemId: string, visuals: string): string[] {
  const gold = itemId === '6646' ? findItem(text, '6916') : null;
  return itemActivities(gold?.text ?? visuals);
}

/** Borrow only the gold model's geometry and rig. Material indices must correspond before
 * moving the normal version's textures and shader metadata onto the donor. */
export function normalCrestOnGoldenRig(normal: Buffer, goldenFile: string): Buffer | null {
  try {
    const original = readGlb(normal), donor = readGlb(embedGlb(goldenFile));
    const look = original.json as CrestGlb, geometry = donor.json as CrestGlb;
    const slots = (gltf: CrestGlb) => [...new Set(gltf.meshes?.flatMap(mesh =>
      mesh.primitives.map(primitive => primitive.material ?? -1)))].sort((a, b) => a - b);
    if (!look.materials?.length || look.materials.length !== geometry.materials?.length
      || !look.meshes?.length || JSON.stringify(slots(look)) !== JSON.stringify(slots(geometry))) return null;
    geometry.images = look.images?.map(image => {
      if (image.uri?.startsWith('data:')) return image;
      const view = look.bufferViews?.[image.bufferView ?? -1];
      if (!view || view.buffer !== 0 || !image.mimeType) throw new Error('Unresolved Crest texture');
      const offset = view.byteOffset ?? 0;
      return { uri: `data:${image.mimeType};base64,${original.bin.subarray(offset, offset + view.byteLength).toString('base64')}` };
    });
    geometry.materials = look.materials;
    geometry.samplers = look.samplers;
    geometry.textures = look.textures;
    geometry.extras = look.extras;
    geometry.extensionsUsed = [...new Set([...(geometry.extensionsUsed ?? []), ...(look.extensionsUsed ?? [])])];
    return writeGlb(geometry, donor.bin);
  } catch {
    return null;
  }
}

/** Prefer the donor rig's attachment points, retaining points unique to the original. */
export function mergeCrestAttachments(normal: Attachment[], donor: Attachment[]): Attachment[] {
  const merged = new Map(normal.map(point => [point.name.toLowerCase(), point]));
  for (const point of donor) merged.set(point.name.toLowerCase(), point);
  return [...merged.values()];
}
