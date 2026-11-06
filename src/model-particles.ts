/**
 * Particles a model brings by itself, with no item table to create them.
 *
 * A model's key values can list particles (`particle_cfg_list`): the game's own pedestals and
 * Lycan's spirit wolves carry their ambient that way, 68 models of the game of 2026-11-06. Each row
 * names a system and which of its control point configurations to start it with, and "preview" is
 * the one a system's author points at the model's attachments. So a wearable under a stock path can
 * carry what the item's `particle_create` entries would have made: the idea of building a look out
 * of files alone comes from Calvin's constructor (dota-studio), this is the game's mechanism
 * written here from its own files.
 *
 * The key values are a text in the model's DATA block, in the KV3 text form, and a system named
 * there must also be in the file's reference list or the game does not load it.
 */
import { readKv3, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, withReferences } from './resource.ts';

const LIST = /(^|[\s{,])particle_cfg_list\s*=\s*\[[\s\S]*?\n?\s*\]\s*,?/;

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);

/** The key values' list of these systems, as the game's own models write it. */
function listText(paths: string[]): string {
  const rows = paths.map((p) => `\t\t{\n\t\t\tname = resource:"${p}"\n\t\t\tconfig = "preview"\n\t\t},\n`);
  return `particle_cfg_list = \n\t[\n${rows.join('')}\t]`;
}

/** `text` with its particle list replaced by these systems; a text of the KV3 kind stays one. */
export function keyValuesWithParticles(text: string, paths: string[]): string {
  const list = listText(paths);
  if (LIST.test(text)) return text.replace(LIST, (_m, before: string) => `${before}${list}`);
  const open = text.lastIndexOf('}');
  if (open < 0) return `<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->\n{\n\t${list}\n}\n`;
  return `${text.slice(0, open)}\t${list}\n${text.slice(open)}`;
}

/**
 * `model` with these particle systems of its own, or null for a model whose block this cannot change.
 * @param paths  the systems, as `.vpcf` paths; the ones already listed are replaced
 */
export function withParticles(model: Buffer, paths: string[]): Buffer | null {
  try {
    const block = resourceBlock(model, 'DATA');
    const kv = readKv3(block.data);
    const text = member(member(kv.root, 'm_modelInfo'), 'm_keyValueText');
    if (text?.kind !== 'string') return null;
    text.value = keyValuesWithParticles(text.value, paths);
    const out = block.replace(writeKv3(kv));
    return withReferences(out, paths);
  } catch {
    return null;
  }
}
