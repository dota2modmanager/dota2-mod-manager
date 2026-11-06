/**
 * An effect made to spread over a wearable's surface.
 *
 * The game's unusual effects start with C_INIT_CreateOnModel reading the model's mesh, which it
 * keeps only for the hero's own body: on a wearable the same system piles up at the model's origin.
 * Calvin's constructor (dota-studio) answers with hitboxes over the item and a copy of the system
 * that reads those instead; the same is done here, against the boxes src/model-hitboxes.ts lays in
 * SURFACE_SET. Each system of the tree is copied under SURFACE: mesh and bones
 * off in its emitters, and a mesh-skinning operator swapped for one that holds a particle to the
 * box it started in, since the item moves with the hero's bones.
 */
import { readKv3, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, withReferences } from './resource.ts';
import { entryAt, type VpkEntry } from './vpk.ts';
import { SURFACE_SET } from './model-hitboxes.ts';

const SURFACE = 'particles/mm_surface/';
const SHELL = 4; // how far off a box a particle starts: inside the item it would not be seen

const no: Kv3Node = { kind: 'other', type: 14 };
const yes: Kv3Node = { kind: 'other', type: 13 };
const word = (value: string): Kv3Node => ({ kind: 'string', value });
const double = (v: number): Kv3Node => { const raw = Buffer.alloc(8); raw.writeDoubleLE(v); return { kind: 'number', type: 5, cell: null, typeAt: null, raw }; };
const int = (v: number): Kv3Node => { const raw = Buffer.alloc(4); raw.writeInt32LE(v); return { kind: 'number', type: 11, cell: null, typeAt: null, raw }; };

/** What holds a particle to its box as the item moves. */
const lockToBox = (): Kv3Node => ({
  kind: 'object',
  members: new Map<string, Kv3Node>([
    ['_class', word('C_OP_LockToBone')], ['m_HitboxSetName', word(SURFACE_SET)], ['m_bUseBones', no], ['m_bRigid', yes],
    ['m_flLifeTimeFadeStart', double(1)], ['m_flLifeTimeFadeEnd', double(1)], ['m_flJumpThreshold', double(100000)],
    ['m_flPrevPosScale', double(1)], ['m_nFieldOutput', int(0)], ['m_nFieldOutputPrev', int(2)],
  ]),
});

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const classOf = (n: Kv3Node) => { const c = member(n, '_class'); return c?.kind === 'string' ? c.value : ''; };
const list = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);

/** The path of a system's copy. */
const copyOf = (system: string) => `${SURFACE}${system.toLowerCase().replace(/^particles\//, '').replace(/_c$/, '')}`;

/** Its emitters turned to the boxes; whether any was on the model. */
function toSurface(root: Kv3Node): boolean {
  let any = false;
  for (const op of list(member(root, 'm_Initializers'))) {
    if (classOf(op) !== 'C_INIT_CreateOnModel' || op.kind !== 'object') continue;
    op.members.set('m_bUseMesh', no);
    op.members.set('m_bUseBones', no);
    op.members.set('m_HitboxSetName', word(SURFACE_SET));
    op.members.set('m_flShellSize', { kind: 'object', members: new Map<string, Kv3Node>([['m_nType', word('PF_TYPE_LITERAL')], ['m_flLiteralValue', double(SHELL)]]) });
    any = true;
  }
  const ops = member(root, 'm_Operators');
  // last, so that it holds what the operators before it moved
  if (ops?.kind === 'array' && any) ops.items = [...ops.items.filter((op) => classOf(op) !== 'C_OP_SnapshotSkinToBones'), lockToBox()];
  return any;
}

/**
 * The copies of `system` and its children that spread over a surface, or null where no system of
 * the tree starts on the model (it hangs on attachment points, and goes on as it is).
 * @returns the root's path, and the files to put in the pak
 */
export function surfaceSystem(read: (p: string) => Buffer | null | undefined, system: string): { root: string; entries: VpkEntry[] } | null {
  const entries: VpkEntry[] = [];
  const seen = new Set<string>();
  let any = false;
  const copy = (path: string) => {
    const from = path.toLowerCase().replace(/_c$/, '');
    if (seen.has(from) || seen.size > 60) return;
    seen.add(from);
    const bytes = read(`${from}_c`);
    if (!bytes) return;
    const block = resourceBlock(bytes, 'DATA');
    const kv = readKv3(block.data);
    if (toSurface(kv.root)) any = true;
    const children: string[] = [];
    for (const c of list(member(kv.root, 'm_Children'))) {
      const ref = member(c, 'm_ChildRef');
      if (ref?.kind !== 'string' || !ref.value || c.kind !== 'object') continue;
      copy(ref.value);
      const to = copyOf(ref.value);
      children.push(to);
      c.members.set('m_ChildRef', { ...ref, value: to });
    }
    const out = block.replace(writeKv3(kv));
    entries.push(entryAt(`${copyOf(from)}_c`, children.length ? withReferences(out, children) : out));
  };
  copy(system);
  return any ? { root: copyOf(system), entries } : null;
}
