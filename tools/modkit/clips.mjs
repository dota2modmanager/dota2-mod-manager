/**
 * `modkit clips <ours.vmdl_c> --hero <hero> --out <dir>`: a hero's model with new animation clips.
 *
 * The clips are made by compiling the hero's model again from Source2Viewer's decompile with your
 * .dmx clips in place of Valve's (skills/dota2-modding/references/animations.md). That compile is
 * not Valve's model: the decompile has no morphs and changes things the game cares about. So only
 * the animation blocks (ANIM, ASEQ, AGRP) of your compile go into Valve's own model from pak01,
 * whose meshes, morphs, physics and the rest stay. Built for the Necrophos "Scream" set, where each
 * of the repairs below was a hero standing in its bind pose or turning its head backwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pak01, src } from './game.mjs';

const memberValue = (n, key) => n.members.get(key)?.value;

/** A node of one KV3 block, with its numbers' bytes copied, to be written into another block. */
function detached(kv, n) {
  if (n.kind === 'object') return { ...n, members: new Map([...n.members].map(([k, c]) => [k, detached(kv, c)])) };
  if (n.kind === 'array') return { ...n, items: n.items.map((c) => detached(kv, c)) };
  if (n.kind === 'number' && n.cell) return { ...n, cell: null, typeAt: null, raw: Buffer.from(kv.buffers[n.cell.buffer].subarray(n.cell.offset, n.cell.offset + n.cell.width)) };
  return n;
}
const int32 = (n) => { const raw = Buffer.alloc(4); raw.writeInt32LE(n); return { kind: 'number', type: 11, cell: null, typeAt: null, raw }; };

/**
 * Valve's model can keep a clip apart from the sequence that plays it, under the sequence's name with
 * @@ in front (necrolyte: cast_ghost_shroud plays @@cast_ghost_shroud). The decompile drops the @@,
 * the compile then has one name for both, and every sequence after it moves up a number: online the
 * server asks for #31 and the hero plays what Valve calls #32. Such clips get their name back, the
 * name list becomes Valve's, and every reference follows its name to the new number.
 * @returns the clips renamed
 */
export function restoreNames(aseq, anim, valveNames, ourNames, valveAnimNames, numberOf) {
  const clipsByName = new Map(anim.root.members.get('m_animArray').items.map((a) => [memberValue(a, 'm_name'), a]));
  const renamed = new Map();
  for (const name of valveNames) {
    const bare = name.replace(/^@+/, '');
    if (ourNames.includes(name) || bare === name || !valveAnimNames.has(name) || valveAnimNames.has(bare)) continue;
    const clip = clipsByName.get(bare);
    if (!clip || clipsByName.has(name)) continue;
    clip.members.get('m_name').value = name;
    renamed.set(bare, name);
  }
  if (!renamed.size) return [];
  const known = new Set([...ourNames, ...renamed.values()]);
  if (valveNames.some((n) => !known.has(n))) return [];
  const at = new Map(valveNames.map((n, i) => [n, i]));
  const ref = (v) => { const raw = Buffer.alloc(4); raw.writeInt32LE(v); return { kind: 'number', type: 11, cell: null, typeAt: null, raw }; };
  for (const s of aseq.root.members.get('m_localS1SeqDescArray').items) {
    // a fetch plays clips: a renamed one under its new name; a layer plays a sequence, which kept its name
    const list = s.members.get('m_fetch').members.get('m_localReferenceArray');
    list.items = list.items.map((r) => { const n = ourNames[numberOf(aseq, r)]; return ref(at.get(renamed.get(n) ?? n)); });
    list.element = undefined;
    for (const l of s.members.get('m_autoLayerArray').items) {
      l.members.set('m_nLocalReference', ref(at.get(ourNames[numberOf(aseq, l.members.get('m_nLocalReference'))])));
    }
  }
  const nameArray = aseq.root.members.get('m_localSequenceNameArray');
  const proto = nameArray.items[0];
  nameArray.items = valveNames.map((n) => ({ ...proto, value: n }));
  return [...renamed.values()];
}

/**
 * `modkit model <hero> [--out model.json]`: what a hero's model holds for whoever makes clips for it.
 * Bones in Valve's order (a clip's tracks go by bone number), and each sequence with the activity
 * that plays it and its modifiers (the decompile drops modifiers; scripts/prepare_vmdl.py puts
 * them back from this file).
 */
export async function model(opts) {
  const hero = opts._[0];
  if (!hero) throw new Error('usage: modkit model <hero> [--out model.json]');
  const { index } = await pak01(opts);
  const rel = `models/heroes/${hero}/${hero}.vmdl_c`;
  const file = index.read(rel);
  if (!file) throw new Error(`no ${rel} in pak01`);
  const { readKv3, numberOf } = await src('kv3.ts');
  const { resourceBlock } = await src('resource.ts');
  const block = (name) => readKv3(resourceBlock(file, name).data).root.members;
  const bones = block('DATA').get('m_modelSkeleton').members.get('m_boneName').items.map((b) => b.value);
  const aseqKv = readKv3(resourceBlock(file, 'ASEQ').data);
  const names = aseqKv.root.members.get('m_localSequenceNameArray').items.map((s) => s.value);
  const descs = aseqKv.root.members.get('m_localS1SeqDescArray').items;
  const sequences = descs.map((s) => {
    const acts = (s.members.get('m_activityArray')?.items ?? []).map((e) => memberValue(e, 'm_name'));
    const fetch = s.members.get('m_fetch').members.get('m_localReferenceArray').items.map((r) => names[numberOf(aseqKv, r)]);
    const looping = memberValue(s.members.get('m_flags'), 'm_bLooping');
    return { number: names.indexOf(memberValue(s, 'm_sName')), name: memberValue(s, 'm_sName'), activity: acts[0] ?? null, modifiers: acts.slice(1), plays: fetch, looping: !!looping };
  });
  const clipsOnly = names.filter((n) => !descs.some((s) => memberValue(s, 'm_sName') === n));
  const anims = block('ANIM').get('m_animArray').items.map((a) => memberValue(a, 'm_name'));
  const out = { hero, bones, sequences, clipsWithoutSequence: clipsOnly, clips: anims };
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(out, null, 1));
  }
  if (opts.json) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`${rel}: ${bones.length} bones, ${names.length} sequence numbers (${descs.length} sequences, ${clipsOnly.length} clips played only through them)`);
  for (const s of sequences) {
    console.log(`  #${String(s.number).padStart(2)} ${s.name.padEnd(32)} ${(s.activity ?? '').padEnd(34)} ${s.modifiers.join(' ')}${s.plays.length > 1 || s.plays[0] !== s.name ? `  plays ${s.plays.join(', ')}` : ''}`);
  }
  if (opts.out) console.log(`written to ${opts.out}`);
}

export async function clips(opts) {
  const oursPath = opts._[0];
  if (!oursPath || !opts.hero || !opts.out) throw new Error('usage: modkit clips <compiled ours.vmdl_c> --hero <hero> --out <dir>');
  const { index } = await pak01(opts);
  const rel = `models/heroes/${opts.hero}/${opts.hero}.vmdl_c`;
  let file = index.read(rel);
  if (!file) throw new Error(`no ${rel} in pak01`);
  const ours = fs.readFileSync(oursPath);
  const { readKv3, numberOf, setNumber } = await src('kv3.ts');
  const { writeKv3 } = await src('kv3-write.ts');
  const { resourceBlock } = await src('resource.ts');
  const block = (f, name) => readKv3(resourceBlock(f, name).data);

  // 0. a clip's tracks go by their place in the animation's bone channel: the compile must list the
  //    bones there as Valve's does, or Valve's poses copied in below move the wrong bones
  const boneChannel = (f) => block(f, 'AGRP').root.members.get('m_decodeKey').members.get('m_dataChannelArray').items
    .find((c) => memberValue(c, 'm_szChannelClass') === 'BoneChannel').members.get('m_szElementNameArray').items.map((b) => b.value);
  const valveBones = boneChannel(file), ourBones = boneChannel(ours);
  const badBone = valveBones.findIndex((b, i) => ourBones[i] !== b);
  if (badBone !== -1 || ourBones.length !== valveBones.length) {
    const early = ourBones[badBone];
    throw new Error(`animated bone #${badBone} is ${early} in your compile and ${valveBones[badBone]} in Valve's. `
      + (valveBones.includes(early) ? `Add "${early}" to "move_last" in prepare_vmdl.py's config and compile again.` : 'The skeletons differ: compile from the hero\'s own decompiled vmdl.'));
  }

  // 1. the server picks a sequence by its number in its own model: same names, same order
  const valveSeq = block(file, 'ASEQ'), aseq = block(ours, 'ASEQ');
  const anim = block(ours, 'ANIM'), valveAnim = block(file, 'ANIM');
  const names = (kv) => kv.root.members.get('m_localSequenceNameArray').items.map((s) => s.value);
  const animNames = (kv) => new Set(kv.root.members.get('m_animArray').items.map((a) => memberValue(a, 'm_name')));
  const valveNames = names(valveSeq), ourNames = names(aseq);
  const valveAnimNames = animNames(valveAnim);
  const restored = restoreNames(aseq, anim, valveNames, ourNames, valveAnimNames, numberOf);
  const firstDiff = valveNames.findIndex((n, i) => names(aseq)[i] !== n);
  if (firstDiff !== -1 || names(aseq).length !== valveNames.length) {
    throw new Error(`sequences differ from Valve's at #${firstDiff} (${valveNames[firstDiff]} / ${names(aseq)[firstDiff]}); `
      + `${names(aseq).length} vs ${valveNames.length}. Swap clips, never add or reorder; put bindPose first in the vmdl's AnimationList.`);
  }

  // 2. the decompile has no morphs: Valve's morph channel goes back into the decode key, or the
  //    game has nothing to drive the face with and draws the hero as a flat glow
  const valveKey = block(file, 'AGRP'), agrp = block(ours, 'AGRP');
  const chans = (kv) => kv.root.members.get('m_decodeKey').members.get('m_dataChannelArray').items;
  const morph = chans(valveKey).find((c) => memberValue(c, 'm_szChannelClass') === 'MorphChannel');
  if (morph && !chans(agrp).some((c) => memberValue(c, 'm_szChannelClass') === 'MorphChannel')) {
    chans(agrp).push(detached(valveKey, morph));
    const count = (kv) => kv.root.members.get('m_decodeKey').members.get('m_nChannelElements');
    setNumber(agrp, count(agrp), numberOf(valveKey, count(valveKey)));
  }

  // 3. a sequence that blends several poses by a pose parameter (the turns layer) comes out of the
  //    decompile as one plain clip: each sequence fetches as Valve's does, with Valve's flags
  //    (m_bMulti says it blends; without it the head turned round while the hero ran)
  const ourSeqs = new Map(aseq.root.members.get('m_localS1SeqDescArray').items.map((s) => [memberValue(s, 'm_sName'), s]));
  let fetched = 0;
  for (const s of valveSeq.root.members.get('m_localS1SeqDescArray').items) {
    const mine = ourSeqs.get(memberValue(s, 'm_sName'));
    const fetch = s.members.get('m_fetch');
    const refs = fetch.members.get('m_localReferenceArray').items.map((r) => numberOf(valveSeq, r));
    if (!mine || refs.length < 2 || refs.includes(-1)) continue;
    const copy = detached(valveSeq, fetch);
    copy.members.get('m_localReferenceArray').items.forEach((r, i) => r.raw.writeIntLE(refs[i], 0, r.raw.length));
    mine.members.set('m_fetch', copy);
    mine.members.set('m_flags', detached(valveSeq, s.members.get('m_flags')));
    fetched++;
  }

  // 4. the poses such a layer blends are Valve's own, segment for segment: the decompile hands them
  //    over as differences from the bind pose and the compiler makes whole poses of them
  const segs = anim.root.members.get('m_segmentArray').items;
  const valveSegs = valveAnim.root.members.get('m_segmentArray').items;
  const maxNode = anim.root.members.get('m_nMaxUniqueFrameIndex');
  let unique = numberOf(anim, maxNode);
  const ourAnims = new Map(anim.root.members.get('m_animArray').items.map((a) => [memberValue(a, 'm_name'), a]));
  // --valve-clips a,b: clips whose names hold any of these words; by default the look poses
  const words = typeof opts['valve-clips'] === 'string' ? opts['valve-clips'].split(',').filter(Boolean) : null;
  const fromValve = { test: (name) => (words ? words.some((w) => name.includes(w)) : name.startsWith('@') && name.includes('_lookFrame_')) };
  const fits = (n, v) => n.raw && v < 2 ** (n.raw.length * 8 - 1);
  const moved = new Map();
  let poses = 0;
  for (const a of valveAnim.root.members.get('m_animArray').items) {
    const name = memberValue(a, 'm_name');
    const mine = ourAnims.get(name);
    if (!fromValve.test(name) || !mine) continue;
    const data = detached(valveAnim, a.members.get('m_pData'));
    a.members.get('m_pData').members.get('m_frameblockArray').items.forEach((vb, b) => {
      const list = data.members.get('m_frameblockArray').items[b].members.get('m_segmentIndexArray');
      vb.members.get('m_segmentIndexArray').items.forEach((vr, i) => {
        const from = numberOf(valveAnim, vr);
        if (!moved.has(from)) {
          const seg = detached(valveAnim, valveSegs[from]);
          const u = seg.members.get('m_nUniqueFrameIndex');
          if (fits(u, ++unique)) u.raw.writeIntLE(unique, 0, u.raw.length); else seg.members.set('m_nUniqueFrameIndex', int32(unique));
          segs.push(seg);
          moved.set(from, segs.length - 1);
        }
        const r = list.items[i], to = moved.get(from);
        if (fits(r, to)) r.raw.writeIntLE(to, 0, r.raw.length); else { list.element = undefined; list.items[i] = int32(to); }
      });
    });
    mine.members.set('m_pData', data);
    mine.members.set('m_movementArray', detached(valveAnim, a.members.get('m_movementArray')));
    poses++;
  }
  setNumber(anim, maxNode, unique);

  // 5. the compiler also makes a clip of each blend's source (turns, immosh_turns) that Valve's model
  //    has not got: one pose, the full turn, which the walk then played. It gets the middle pose.
  const extra = [];
  for (const [name, clip] of ourAnims) {
    if (valveAnimNames.has(name)) continue;
    const still = ourAnims.get(`@${name}_lookFrame_1`);
    if (still) clip.members.set('m_pData', detached(anim, still.members.get('m_pData')));
    else extra.push(name);
  }

  file = resourceBlock(file, 'ANIM').replace(writeKv3(anim));
  file = resourceBlock(file, 'ASEQ').replace(writeKv3(aseq));
  file = resourceBlock(file, 'AGRP').replace(writeKv3(agrp));
  const out = path.join(opts.out, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, file);
  if (restored.length) console.log(`clips renamed back to Valve's names: ${restored.join(', ')}`);
  console.log(`${rel}: ${valveNames.length} sequences in Valve's order, ${fetched} blends fetched as Valve's, ${poses} pose clips from Valve's${morph ? ', morph channel restored' : ''}`);
  if (extra.length) console.log(`clips Valve's model has not got (unused by the game): ${extra.join(', ')}`);
  console.log(`written to ${out}. Run npm run doctor on the packed mod, then watch the run and the idle in the bench.`);
}
