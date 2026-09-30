/* The load order in two parts.
 *
 * The game mounts pakNN_dir.vpk in numeric order and the first copy of a file wins, so a mod's
 * slot number is its priority. Some categories have to load before everything else: trees,
 * river, shaders, hero effects and a few more replace files other mods ship too, and lose
 * otherwise. Slots 02-29 belong to them; every other mod starts at 30.
 *
 * Since 2026-09-24. Until then only the first install kept the two apart: a mod
 * moved up past a shader took the shader's slot, and a shader imported by hand and then linked
 * to the catalog stayed wherever the import had put it. 28 slots rather than the old eight
 * because those categories hold 217 catalog mods between them, 126 of them hero items, and eight
 * ran out after one shader, one set of trees, one river and a few items.
 *
 * The installer hands out slots through freeSlotIn; moving a mod between the two parts, and the
 * one-time layout of an order from before, live here too so the rules sit in one place.
 */
import { RESERVED_PAKS } from './minify.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord, HasFiles } from './types.ts';

/** The two ranges a pak can sit in: early slots that load first, and everything after. */
export type Zone = 'priority' | 'normal';

/** What of the installer this asks: which slot a record's pak sits in, which slots are taken, and moving one. */
export interface SlotInstaller {
  slotNumber(rec: LibRecord): number | null;
  slotBase(rec: HasFiles): string | null;
  usedPakNames(): Set<string>;
  moveToSlot(rec: HasFiles, base: string, from?: string | null): LibFile[];
}

/** One record on its way to another slot, parked under a temporary name in between. */
type Move = { r: LibRecord; n: number; to: string; from: string; park: string; parked: LibFile[]; files: LibFile[] };

/** The categories that load before every other mod. The Dota2PornFx cart zips mark them with a
 *  "!pak" prefix, a merge-order hint for VPKMerge; the game only mounts pakNN_dir.vpk. */
export const PRIORITY_CATEGORIES: readonly string[] = ['trees', 'river', 'shaders', 'herofx', 'ranged-attack', 'hero-items', 'optimization'];
/** The first and last slot of those categories. */
export const PRIORITY_SLOTS: readonly [number, number] = [2, 29];
/** Where every other mod starts. */
export const NORMAL_FIRST = 30;
/* The app's own pak, not a mod: the clearer text for the game's anti-cheat notice
 * (src/notice-text.ts). One below Minify's 65-67, so that it wins over a Minify "English fix"
 * carrying the same localization file, and never handed to a mod, counted as a slot, listed as
 * somebody else's file or renamed by the master switch. A mod that had it before is moved off
 * by vacateAppPak. */
export const APP_PAK = 64;

/** Whether a lowercased file name in the language folder is the app's own pak. */
export const isAppPak = (baseLower: string): boolean => baseLower === `pak${APP_PAK}_dir.vpk`;

/** Whether a category is one of those that load first. */
export const isPriorityCategory = (categoryId: string): boolean => PRIORITY_CATEGORIES.includes(categoryId);

/** Which part of the load order a category's mods belong in. */
export const zoneFor = (categoryId: string): Zone => (isPriorityCategory(categoryId) ? 'priority' : 'normal');

/** Which part of the load order a slot number is in. */
export const slotZone = (n: number): Zone => (n >= PRIORITY_SLOTS[0] && n <= PRIORITY_SLOTS[1] ? 'priority' : 'normal');

/**
 * The first free slot of a part of the load order, as a file name, or null when it is full.
 * @param {'priority'|'normal'} zone
 * @param {Set<string>} used  lowercased pakNN_dir.vpk names already taken
 */
export function freeSlotIn(zone: Zone, used: Set<string>): string | null {
  const [from, to] = zone === 'priority' ? PRIORITY_SLOTS : [NORMAL_FIRST, 99];
  for (let n = from; n <= to; n++) {
    // Minify writes 65, 66 and 67 into whichever language folder it is set to, and if that is
    // ours, whoever writes second replaces the other's mod. Three slots out of ninety buys never
    // having to coordinate - see src/minify.ts. A pak it has already written needs no
    // reserving: it is in `used`, read off the folder.
    if (RESERVED_PAKS.includes(n) || n === APP_PAK) continue;
    const name = `pak${String(n).padStart(2, '0')}_dir.vpk`;
    if (!used.has(name)) return name;
  }
  return null;
}

/**
 * Move a mod into the part of the load order its category belongs in, when it is not there.
 * Linking an import to the catalog is where this matters: the import could not know the
 * category and took a slot among the rest.
 * @returns {Array<object>|null} the record's new files, or null when it stays where it is
 *   (already in place, no slot, or its part of the order full)
 */
export function moveToZone(installer: SlotInstaller, rec: LibRecord): LibFile[] | null {
  const n = installer.slotNumber(rec);
  if (n === null) return null;
  const want = zoneFor(rec.categoryId);
  if (slotZone(n) === want) return null;
  const free = freeSlotIn(want, installer.usedPakNames());
  if (!free) return null;
  return installer.moveToSlot(rec, free.replace(/_dir\.vpk$/i, ''));
}

/**
 * Lay an existing load order out in its two parts, once. The order within each part is kept;
 * what changes is that every priority mod now comes before every other one, and that the rest
 * start at 30. Files that are not ours keep their slots.
 *
 * Every file is renamed twice, first to a name the game never mounts and then to its new slot,
 * so no step lands on a slot another mod still holds. A failure puts back everything already
 * renamed and throws; the caller tries again on the next start.
 * @returns {{ moved: number }|null} null when there is nothing to lay out, or it would not fit
 */
export function migrateSlotZones(installer: SlotInstaller, library: Pick<Library, 'list' | 'update'>): { moved: number } | null {
  const recs = library.list()
    .map((r) => ({ r, n: installer.slotNumber(r) }))
    .filter((x): x is { r: LibRecord; n: number } => x.n !== null)
    .sort((a, b) => a.n - b.n);
  if (!recs.length) return null;
  const ours = new Set(recs.map((x) => `${installer.slotBase(x.r)}_dir.vpk`));
  const taken = new Set([...installer.usedPakNames()].filter((f) => /^pak\d+_dir\.vpk$/.test(f) && !ours.has(f)));
  const hand = (zone: Zone) => {
    const f = freeSlotIn(zone, taken);
    if (f) taken.add(f);
    return f;
  };
  const plan = [
    ...recs.filter((x) => isPriorityCategory(x.r.categoryId)).map((x) => ({ ...x, to: hand('priority') || hand('normal') })),
    ...recs.filter((x) => !isPriorityCategory(x.r.categoryId)).map((x) => ({ ...x, to: hand('normal') })),
  ];
  if (plan.some((p) => !p.to)) return null;
  const moving: Move[] = plan
    .filter((p) => `${installer.slotBase(p.r)}_dir.vpk` !== p.to)
    // every plan has a slot by now: a missing one returned above
    // every record here has a slot: the ones without were filtered out above
    .map((p) => ({ ...p, from: installer.slotBase(p.r) as string, park: `mmslot${p.n}`, to: (p.to as string).replace(/_dir\.vpk$/i, ''), parked: [], files: [] }));
  if (!moving.length) return { moved: 0 };

  const done: { p: Move; files: LibFile[]; from: string; to: string }[] = [];
  const step = (p: Move, files: LibFile[], from: string, to: string) => {
    const out = installer.moveToSlot({ ...p.r, files }, to, from);
    done.push({ p, files: out, from, to });
    return out;
  };
  try {
    for (const p of moving) p.parked = step(p, p.r.files, p.from, p.park);
    for (const p of moving) p.files = step(p, p.parked, p.park, p.to);
  } catch (err) {
    for (const d of done.reverse()) {
      try { installer.moveToSlot({ ...d.p.r, files: d.files }, d.from, d.to); } catch { /* nothing else to try */ }
    }
    throw err;
  }
  for (const p of moving) library.update(p.r.id, { files: p.files });
  return { moved: moving.length };
}

/**
 * Move a mod off the app's own slot. Until the notice claimed 64, a library of 34 mods or more
 * could have one there. It goes to the first free slot after 64, so it stays behind the mods it
 * was behind, or to the first free one of its part when those are full. A rename the running
 * game refuses puts back what already moved and throws; the next call tries again.
 * @returns {boolean} whether a mod moved
 */
export function vacateAppPak(installer: SlotInstaller, library: Pick<Library, 'list' | 'update'>): boolean {
  const rec = library.list().find((r) => installer.slotNumber(r) === APP_PAK);
  if (!rec) return false;
  const used = installer.usedPakNames();
  let to: string | null = null;
  for (let n = APP_PAK + 1; n <= 99 && !to; n++) {
    const name = `pak${n}_dir.vpk`;
    if (!RESERVED_PAKS.includes(n) && !used.has(name)) to = name;
  }
  to = to || freeSlotIn(zoneFor(rec.categoryId), used) || freeSlotIn('normal', used);
  if (!to) return false;
  const from = `pak${APP_PAK}`;
  const base = to.replace(/_dir\.vpk$/i, '');
  // a refused rename puts back what already moved inside moveToSlot, so a throw here is clean
  library.update(rec.id, { files: installer.moveToSlot(rec, base, from) });
  return true;
}

