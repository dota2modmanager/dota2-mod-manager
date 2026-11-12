/* A model put under a plain hero's path with its attachments in the plain model's order (Discord,
 * Acolyte of the Lost Arts: Invoker's orbs under his feet in a lobby on Valve's servers).
 *
 * Online the server keeps the plain hero and tells the client which attachment a particle sits on
 * by its number in the plain model's list, as it does for animations (src/model-sequences.ts
 * numberedAs). Invoker's plain model has attach_orb2, attach_orb1, attach_orb3 at 6, 7 and 8 of
 * 12; the persona's body, compiled again, has the orbs first and seven in all, so the orbs went on
 * attachments it has not got and stood at his feet. In "Try out" and with bots the client is the
 * server too and reads the names from the model it has, which is why it looked right there.
 *
 * Each plain attachment's number gets the model's own attachment of that name. One the model has
 * not got gets a stand-in: the model's attach_hitloc (or its first) under the plain name, so a
 * particle put there is on the body rather than on the floor. The model's attachments the plain
 * one has not got go after them.
 */
import fs from 'node:fs';
import { readKv3, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';
import { entryAt, entryPath, type VpkEntry } from './vpk.ts';
import { sharedVpkIndexSteps } from './vpk-shared.ts';
import { PAUSE } from './steps.ts';
import type { ReadyBase } from './arcana-bases.ts';

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const nameOf = (a: Kv3Node) => { const k = member(a, 'key'); return k?.kind === 'string' ? k.value : ''; };

/** The names of a model's attachments, in order; empty when it has none or cannot be read. */
export function attachmentNames(model: Buffer): string[] {
  try {
    if (!resourceBlocks(model).some((b) => b.name === 'MDAT')) return [];
    const list = member(readKv3(resourceBlock(model, 'MDAT').data).root, 'm_attachments');
    return list?.kind === 'array' ? list.items.map(nameOf) : [];
  } catch {
    return [];
  }
}

/** An attachment under another name: the same place on the body. */
function renamed(a: Kv3Node, name: string): Kv3Node {
  if (a.kind !== 'object') return a;
  const value = member(a, 'value');
  const members = new Map(a.members).set('key', { kind: 'string', value: name });
  if (value?.kind === 'object') members.set('value', { ...value, members: new Map(value.members).set('m_name', { kind: 'string', value: name }) });
  return { ...a, members };
}

/**
 * `model` with its attachments numbered as `plain` numbers them. The model as it is when they are
 * in that order already, or when either cannot be read (it then looks right in "Try out" still).
 */
export function attachedAs(model: Buffer, plain: Buffer): Buffer {
  const wanted = attachmentNames(plain);
  if (!wanted.length) return model;
  try {
    let out = model;
    const blocks = resourceBlocks(model).filter((b) => b.name === 'MDAT').length;
    for (let nth = 0; nth < blocks; nth++) {
      const block = resourceBlock(out, 'MDAT', nth);
      const kv = readKv3(block.data);
      const list = member(kv.root, 'm_attachments');
      if (list?.kind !== 'array' || !list.items.length) continue;
      const names = list.items.map(nameOf);
      if (wanted.every((n, i) => names[i] === n)) continue;
      const own = new Map(list.items.map((a) => [nameOf(a), a]));
      const standIn = own.get('attach_hitloc') ?? list.items[0];
      list.items = [
        ...wanted.map((n) => own.get(n) ?? renamed(standIn, n)),
        ...list.items.filter((a) => !wanted.includes(nameOf(a))),
      ];
      out = block.replace(writeKv3(kv));
    }
    return out;
  } catch {
    return model;
  }
}

/** A base's files with each model numbered as the game's model at its path (attachedAs). */
export function entriesAttachedAs(entries: VpkEntry[], read: (p: string) => Buffer | null): VpkEntry[] {
  return entries.map((e) => {
    const p = entryPath(e);
    const plain = p.endsWith('.vmdl_c') ? read(p) : null;
    const fixed = plain ? attachedAs(e.data, plain) : e.data;
    return fixed === e.data ? e : entryAt(p, fixed);
  });
}

/** The arcana bases of a build with their models numbered as the game's, a pause after each base. */
export function* basesAttachedSteps(ready: ReadyBase[], pak: string): Generator<typeof PAUSE, ReadyBase[]> {
  if (!ready.length || !fs.existsSync(pak)) return ready;
  const ix = yield* sharedVpkIndexSteps(pak);
  const out: ReadyBase[] = [];
  for (const r of ready) {
    const entries = entriesAttachedAs(r.entries, (p) => ix.read(p));
    out.push(entries.every((e, i) => e === r.entries[i]) ? r : { ...r, entries });
    yield PAUSE;
  }
  return out;
}
