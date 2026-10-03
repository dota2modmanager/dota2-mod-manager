/* How a preset travels to somebody else (src/presets-service.ts applies, packs and receives
 * them). A mod the catalog can hand the receiver goes as its identity, a few bytes; one it cannot
 * goes as its own bytes, packed into the file; one with neither is named and left out. This is
 * where that is decided, for the share dialog's plan, for a link, and for the card that says
 * what installing a received preset would actually do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { Catalog } from './catalog.ts';
import type { LibRecord, PackMember, Preset, PresetEntry } from './types.ts';

/** A mod as a catalog category lists it, as far as a preset reads it. */
type CatalogMod = { name?: string; file?: string; preview?: string; styles?: { label: string; file?: string; preview?: string }[] };

/** What a catalog mod needs to be fetched again: the identity, and the archive and picture it comes with. */
type CatalogHit = { categoryId: string; name: string; styleLabel: string | null; fileRef?: string; preview?: string };

/** Every catalog mod by "<categoryId>|<name>|<styleLabel>", with a lookup that never throws. */
export type CatalogIndex = Map<string, CatalogHit> & { lookup: (c: string, n: string, s?: string | null) => CatalogHit | null };

/** A mod as it would be shared: embedded ones read their bytes only when the file is written. */
export type ShareEntry =
  | { kind: 'catalog'; categoryId: string; name: string; styleLabel: string | null; fp: string | null; size: number }
  | { kind: 'missing'; name: string; reason: string }
  | { kind: 'embedded'; name: string; categoryId: string; info: string; fp: string | null; size: number; loadData: () => Buffer }
  | { kind: 'pack'; name: string; members: ShareEntry[] };

/** A share entry without its loader, as the window is shown it; `key` is what it sends back to leave one out. */
type PlanRow = { key: string; kind: string; name: string; size: number; info: string; reason: string; members?: PlanRow[] };

/** What of the installer the plan reads: what a record is, and where its bytes are. */
interface PlanInstaller {
  analyzeRecord(rec: LibRecord): { fp?: string | null; info?: string } | null;
  langFolder(): string;
  mergeToSingleVpk(rec: LibRecord, deltas: unknown): Buffer;
  packMemberFile(packId: string, memberId: string): string;
}

// The mods of one catalog category. Most categories are a flat array, but some (creeps,
// towers, hero-items, item-effects, creep-deny) group theirs under `groups` - the same two
// shapes the catalog view walks (see categoryMods in renderer/views/catalog/lists.ts). Reading only the
// flat ones meant every mod in a grouped category looked like it was not in the catalog:
// the share dialog called them the user's own and packed them into the file as bytes, and
// a preset link dropped them entirely.
export function categoryModList(data: unknown): CatalogMod[] {
  if (Array.isArray(data)) return data;
  const grouped = data as { groups?: { mods?: CatalogMod[] }[] } | null;
  if (grouped && Array.isArray(grouped.groups)) return grouped.groups.flatMap((g) => g.mods || []);
  return [];
}

/** The plan, over the catalog, the installer and the library src/presets-service.ts holds. */
export function createPresetPlan({ catalog, installer, library }: {
  catalog: Pick<Catalog, 'load'>; installer: PlanInstaller; library: Library;
}) {
  /* "<categoryId>|<name>|<styleLabel>" -> what mods:install needs to fetch it.
   *
   * lookup() goes on the map before anything can fail. It used to be attached at the end, so the
   * early return for a catalog that could not be loaded (offline, nothing cached) handed back a
   * map without it, and every caller asking cat.lookup() threw: a first start without a network
   * could not list, share or apply a preset. Empty now means "nothing in the catalog", which is
   * the truth, and a preset's own embedded mods still travel. */
  async function catalogIndex(): Promise<CatalogIndex> {
    const key = (c: string, n: string, s?: string | null) => `${c}|${n}|${s || ''}`;
    const map: CatalogIndex = Object.assign(new Map<string, CatalogHit>(), {
      lookup: (c: string, n: string, s?: string | null) => map.get(key(c, n, s)) || null,
    });
    let data;
    try { data = await catalog.load(); } catch { return map; } // offline with no cache
    for (const [categoryId, list] of Object.entries((data.mods && data.mods.modsData) || {})) {
      for (const m of categoryModList(list)) {
        if (!m || !m.name) continue;
        if (Array.isArray(m.styles)) {
          for (const s of m.styles) {
            map.set(key(categoryId, m.name, s.label), { categoryId, name: m.name, styleLabel: s.label, fileRef: s.file, preview: s.preview });
          }
        } else {
          map.set(key(categoryId, m.name, null), { categoryId, name: m.name, styleLabel: null, fileRef: m.file, preview: m.preview });
        }
      }
    }
    return map;
  }

  // How one library record travels: as a catalog identity when the catalog can hand it to
  // the receiver, otherwise as its own bytes. `loadData` is deferred so building the plan
  // (which only needs sizes) doesn't merge tens of MB per mod.
  function shareEntryFor(rec: LibRecord, cat: CatalogIndex): ShareEntry {
    const hit = rec.categoryId !== 'imported' && cat.lookup(rec.categoryId, rec.name, rec.styleLabel);
    if (hit) {
      return {
        kind: 'catalog', categoryId: rec.categoryId, name: rec.name,
        styleLabel: rec.styleLabel || null, fp: (installer.analyzeRecord(rec) || {}).fp || null, size: 0,
      };
    }
    const hasVpk = (rec.files || []).some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    if (!hasVpk) {
      return { kind: 'missing', name: rec.name, reason: t('нет в каталоге и нечего вложить') };
    }
    let size = 0;
    try {
      const lang = installer.langFolder();
      for (const f of (rec.files || []).filter((x) => x.root === 'lang')) {
        const p = ['', '.off', '.moff'].map((s) => path.join(lang, f.relPath) + s).find((x) => fs.existsSync(x));
        if (p) size += fs.statSync(p).size;
      }
    } catch { /* size stays an estimate of 0 */ }
    const a = installer.analyzeRecord(rec) || {};
    return {
      kind: 'embedded', name: rec.name, categoryId: rec.categoryId, info: a.info || '', fp: a.fp || null,
      size, loadData: () => installer.mergeToSingleVpk(rec, rec.schema),
    };
  }

  // A pack travels as its members: each one keeps its own identity, and the receiver's app
  // rebuilds the pack from them. Member VPKs are already sitting flattened in packsDir.
  function packShareEntry(rec: LibRecord, cat: CatalogIndex): ShareEntry {
    const members = (rec.members || []).map((m): ShareEntry => {
      const hit = m.categoryId !== 'imported' && cat.lookup(m.categoryId, m.name, m.styleLabel);
      if (hit) {
        return { kind: 'catalog', categoryId: m.categoryId, name: m.name, styleLabel: m.styleLabel || null, fp: m.fp || null, size: 0 };
      }
      const src = installer.packMemberFile(rec.id, m.id);
      if (!fs.existsSync(src)) return { kind: 'missing', name: m.name, reason: t('файл участника пака не найден') };
      return {
        kind: 'embedded', name: m.name, categoryId: m.categoryId, info: m.info || '', fp: m.fp || null,
        size: fs.statSync(src).size, loadData: () => fs.readFileSync(src),
      };
    });
    return { kind: 'pack', name: rec.name, members };
  }

  // Every mod of a preset, described the way it would be shared.
  async function presetShareEntries(preset: Preset): Promise<ShareEntry[]> {
    const cat = await catalogIndex();
    const out: ShareEntry[] = [];
    for (const id of library.presetModIds(preset)) {
      const rec = library.find(id);
      if (!rec) continue;
      out.push(rec.kind === 'pack' ? packShareEntry(rec, cat) : shareEntryFor(rec, cat));
    }
    return out;
  }

  // strips the deferred loaders so the plan can cross the IPC boundary; `key` is what the
  // renderer sends back to leave an oversized mod out of the file
  function planShape(entries: ShareEntry[]): PlanRow[] {
    const plain = (e: ShareEntry, key: string): PlanRow => ({
      key, kind: e.kind, name: e.name,
      size: ('size' in e && e.size) || 0, info: ('info' in e && e.info) || '', reason: ('reason' in e && e.reason) || '',
    });
    return entries.map((e, i) => (e.kind === 'pack'
      ? { ...plain(e, String(i)), members: e.members.map((m, j) => plain(m, `${i}.${j}`)) }
      : plain(e, String(i))));
  }

  // fingerprint -> installed record id, so a shared mod already on disk isn't written twice
  function installedFpIndex(): Map<string, string> {
    const map = new Map<string, string>();
    for (const rec of library.list()) {
      if (rec.kind === 'pack') continue;
      const a = installer.analyzeRecord(rec);
      if (a && a.fp) map.set(a.fp, rec.id);
    }
    return map;
  }

  // The mods of a preset flattened for a link, plus the names of the ones that cannot ride
  // along. A link carries identities only, so a mod the receiver has no way to fetch — a
  // user's own import — has to be left out; the rest of the build still travels, and the
  // sender is told exactly what was dropped. Refusing to make a link at all over one import
  // is what made "share by link" look broken in a library that is mostly imports.
  //
  // A pack flattens to its members: packing is a local storage choice, not part of the build.
  // A cosmetic pick travels too — slot + item id is a few bytes, and needs no catalog lookup
  // at all (both players' games carry the same Valve schema).
  function presetLinkMods(preset: Preset, cat: CatalogIndex): { mods: { kind: 'catalog'; categoryId: string; name: string; styleLabel: string | null }[]; skipped: string[] } {
    const mods: { kind: 'catalog'; categoryId: string; name: string; styleLabel: string | null }[] = [];
    const skipped: string[] = [];
    for (const id of library.presetModIds(preset)) {
      const rec = library.find(id);
      if (!rec) continue;
      for (const it of (rec.kind === 'pack' ? rec.members || [] : [rec]) as PackMember[]) {
        if (it.categoryId === 'imported' || !cat.lookup(it.categoryId, it.name, it.styleLabel)) {
          skipped.push(it.name);
          continue;
        }
        mods.push({ kind: 'catalog', categoryId: it.categoryId, name: it.name, styleLabel: it.styleLabel || null });
      }
    }
    return { mods, skipped };
  }

  // What installing a received preset would actually do, for the card in the Presets tab.
  async function sharedPresetStatus(preset: Preset, cat: CatalogIndex) {
    const fpIndex = installedFpIndex();
    const out = { installed: 0, download: 0, embedded: 0, free: 0, unavailable: [] as string[] };
    const visit = (e: PresetEntry) => {
      if (e.kind === 'catalog') {
        if (library.findByKey(e.categoryId, e.name, e.styleLabel)) out.installed++;
        else if (cat.lookup(e.categoryId, e.name, e.styleLabel)) out.download++;
        else out.unavailable.push(e.name);
      } else if (e.kind === 'embedded') {
        if (e.fp && fpIndex.has(e.fp)) out.installed++;
        else out.embedded++;
      } else if (e.kind === 'cosmetic') {
        // free either way — nothing to fetch, just an instant pick from the local game schema
        const have = library.list().find((r) => r.categoryId === 'cosmetic'
          && r.slot === e.slot && r.itemId === e.itemId && String(r.effectId || '') === String(e.effectId || ''));
        if (have && have.enabled !== false) out.installed++;
        else out.free++;
      } else {
        out.unavailable.push(e.name);
      }
    };
    for (const e of preset.wanted || []) {
      if (e.kind === 'pack') e.members.forEach(visit);
      else visit(e);
    }
    return out;
  }

  return { catalogIndex, shareEntryFor, packShareEntry, presetShareEntries, planShape, installedFpIndex, presetLinkMods, sharedPresetStatus };
}
