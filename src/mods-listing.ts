/* What My mods is drawn from: the answer to mods:list (src/ipc-mods.ts), which every screen asks
 * for again after anything changes.
 *
 * It does more than list. A mod whose files were deleted from the game folder drops out of the
 * library; a foreign file is named as a copy of a library mod when it is one, and as a catalog
 * mod when the catalog knows it; an import still called "pakNN" gets a real name once; every row
 * says which switched-on mod hides its files; the item blocks stay in the main process; and the
 * ownership note and the anti-cheat notice are kept current, because this is the one call that
 * follows every change.
 */
import { errorText } from './error-text.ts';
import * as zones from './slot-zones.ts';
import type { AppContext } from './app-context.ts';
import type { ForeignItem } from './installer-folder.ts';
import type { CatalogIdentity } from './fingerprints.ts';
import type { createTerrainAges } from './terrain-age.ts';
import type { createNoticeText } from './notice-text.ts';

/** A file in the language folder the app did not put there, as My mods lists it. */
type ExternalRow = Omit<ForeignItem, 'kind'> & {
  /** a font set is found by matching the fonts folder against the catalog, not by a pak */
  kind: ForeignItem['kind'] | 'font';
  /** the catalog mods this file is byte for byte */
  match?: CatalogIdentity[] | null;
  /** the library mod it is a leftover copy of */
  duplicateOf?: string;
  coveredBy?: { name: string; files: number }[];
};

/** The services the listing reads, and the two helpers src/ipc-mods.ts builds over them. */
type ListingDeps = Pick<AppContext, 'installer' | 'library' | 'fingerprints' | 'schemaService' | 'diag' | 'refreshPresence' | 'verifyStuck'> & {
  terrainAges: ReturnType<typeof createTerrainAges>;
  notice: ReturnType<typeof createNoticeText>;
};

/** The mods:list answer, built over the services src/ipc-mods.ts hands it. */
export function createModsListing({ installer, library, fingerprints, schemaService, terrainAges, notice, diag, refreshPresence, verifyStuck }: ListingDeps) {
  return function listMods() {
    // a mod still on the slot the notice text took moves off it (src/slot-zones.ts)
    try { if (zones.vacateAppPak(installer, library)) diag('a mod moved off the notice slot'); } catch (err) { diag(`notice slot not freed: ${errorText(err)}`); }
    // folder sync: a mod deleted straight from the game folder drops out of the library
    try {
      for (const rec of [...library.list()]) {
        if (rec.kind === 'pack') {
          if ((rec.files || []).length && !installer.langPrimaryPresent(rec)) {
            installer.removePackFully(rec);
            library.removeRecord(rec.id);
          }
        } else if (!installer.langPrimaryPresent(rec)) {
          library.removeRecord(rec.id);
        }
      }
    } catch { /* no game path yet — nothing to sync */ }

    let external: ExternalRow[] = [];
    // fingerprint -> a mod already in the library, so a file that is byte-identical to
    // something managed can be called what it is (a leftover copy) instead of a mystery
    const installedFps = new Map<string, string>();
    try {
      for (const rec of library.list()) {
        if (rec.kind === 'pack') continue;
        const a = installer.analyzeRecord(rec);
        if (a && a.fp && !installedFps.has(a.fp)) installedFps.set(a.fp, rec.name);
      }
    } catch { /* no game path — nothing to compare against */ }
    try {
      const known = library.knownFiles();
      const canMatch = fingerprints.hasData();
      external = installer.externalFiles(known, { scanExtras: canMatch });
      for (const f of external) {
        if (!f.fp) continue;
        f.match = fingerprints.match(f.fp); // recognise catalog mods
        if (installedFps.has(f.fp)) f.duplicateOf = installedFps.get(f.fp);
      }
      // lang-root files are always worth listing; maps/cursor only when recognised
      external = external.filter((f) => f.primary || f.match);
      // fonts share panorama\fonts with vanilla — subset-match instead of a folder fp
      if (canMatch && fingerprints.fonts.length && !known.some((f) => f.root === 'fonts')) {
        const fh = installer.fontFolderHashes();
        for (const m of (fh ? fingerprints.matchFonts(fh) : [])) {
          external.push({
            kind: 'font', key: `__font__${m.name}`, name: m.name, primary: false,
            size: 0, enabled: true, files: Object.keys(m.files).map((bn) => ({ root: 'fonts', relPath: bn })),
            match: [{ name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null }],
          });
        }
      }
    } catch { /* lang folder may not exist yet */ }
    // imported mods have no catalog identity — tag them by content, match to catalog if known
    const installed = library.list().map((rec) => {
      if (rec.categoryId !== 'imported') return rec;
      try {
        const a = installer.analyzeRecord(rec);
        // fpOriginal: the file was repacked to drop the whole-game tables it shipped, so
        // match on what it hashed to before that, or a recognised mod becomes unknown
        const matches = fingerprints.match(rec.fpOriginal || a?.fp);
        // one-time: give bare "pakNN" imports a real name — the catalog name if the file
        // is recognised, otherwise the content (hero / set / kind)
        if (/^!?pak\d+$/i.test(rec.name)) {
          const dir = rec.files.find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
          const nm = (matches && matches[0] && matches[0].name) || (dir && installer.displayNameForFile(dir.relPath));
          if (nm && nm !== rec.name) { library.update(rec.id, { name: nm }); rec.name = nm; }
        }
        return { ...rec, ...a, match: matches };
      } catch { return rec; }
    });
    // Who is quietly covering whom. Both lists take part: a foreign file in the folder is
    // mounted by the game exactly like a managed one, so leaving it out would name the wrong
    // winner. Only switched-on mods, because a switched-off one is renamed and never mounted.
    let covered = new Map();
    try {
      const live = [
        ...installed.filter((r) => r.enabled).map((r) => ({ key: r.id, name: r.name, files: r.files })),
        ...external.filter((f) => f.enabled).map((f) => ({ key: f.key, name: f.name, files: f.files })),
      ];
      covered = installer.coverage(live);
    } catch { /* no game path — nothing is mounted, nothing covers anything */ }
    external = external.map((f) => (covered.has(f.key) ? { ...f, coveredBy: covered.get(f.key) } : f));

    // a whole-map terrain built for an older map than the game's: marked on its row, and its
    // build date kept on the record once found, so a cleared download cache does not lose it
    let terrains = new Map();
    try {
      terrains = terrainAges.forRecords(installed);
      for (const [id, a] of terrains) {
        const rec = library.find(id);
        if (rec && Number.isFinite(a.builtAt) && rec.mapBuiltAt !== a.builtAt) library.update(id, { mapBuiltAt: a.builtAt });
      }
    } catch { /* no game path */ }

    let slots = 0;
    try { slots = installer.usedModSlots(); } catch { /* no game path */ }
    /* Leave a note on disk saying which files here are ours. This handler already reconciles
     * the library against the folder and the renderer re-lists after every install, toggle,
     * preset and bulk action, so it is the one place that keeps the note honest without
     * hooking a dozen handlers - the same reason refreshPresence() sits here. */
    const noteOwnership = () => {
      try { installer.writeOwnership([...library.knownLangRelPaths(), ...notice.ownedFiles()]); } catch (err) { diag(`ownership note skipped: ${errorText(err)}`); }
    };
    noteOwnership();
    // The anti-cheat notice in plain words (src/notice-text.ts), kept current from here for the
    // same reason. After the reply: a rebuild reads the game's own index, and the list is what
    // the screen is waiting for. A rebuild that wrote or removed the pak writes the note again,
    // or the note would miss it until the next listing.
    setImmediate(() => { if (notice.refresh()) noteOwnership(); });
    // the renderer re-lists after every install, toggle, preset and bulk action, so this is
    // the one place that keeps the Discord status honest without hooking a dozen handlers
    refreshPresence();
    // The lifted item blocks are only ever needed in the main process; the renderer just
    // shows that a mod has them, and whether the patch that makes them work is on. Copies,
    // never the stored records — dropping the field off those would erase it on save.
    const schemaOn = schemaService.state().enabled;
    // zone: which part of the load order the mod belongs in (src/slot-zones.ts, PRIORITY_SLOTS), so
    // the screen knows where "load earlier" stops
    const listed = installed.map((rec) => {
      const by = covered.get(rec.id);
      const zone = installer.zoneFor(rec.categoryId);
      const staleMap = !!terrains.get(rec.id)?.stale;
      if (!Array.isArray(rec.schema)) return { ...rec, zone, staleMap, ...(by ? { coveredBy: by } : {}) };
      const { schema, ...rest } = rec;
      return { ...rest, zone, staleMap, schemaCount: schema.length, schemaLive: schemaOn, ...(by ? { coveredBy: by } : {}) };
    });
    return { installed: listed, external, slots, slotCeil: 98, verifyStuck: verifyStuck() };
  };
}
