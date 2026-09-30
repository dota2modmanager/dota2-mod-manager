// Library: manifest of installed mods + presets
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { LibFile, LibRecord, ModIdentity, Preset } from './types.ts';

/** A record as far as telling mods apart goes. No category means an import. */
type ModLike = { name: string; categoryId?: string; styleLabel?: string | null; fp?: string | null };

/** What manifest.json holds. */
interface Manifest { installed: LibRecord[]; presets: Preset[] }

/** What adding a record takes; the id, the switch and the time are the library's own. */
export interface NewRecord {
  name: string;
  categoryId: string;
  styleLabel?: string | null;
  fileRef?: string | null;
  preview?: string | null;
  files: LibFile[];
  kind?: string;
  members?: Record<string, unknown>[];
}

export class Library {
  file: string;
  data: Manifest;

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'manifest.json');
    this.data = { installed: [], presets: [] };
    this.load();
  }

  load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        this.data = { installed: [], presets: [], ...parsed };
      }
    } catch {
      // keep defaults; corrupted manifest is preserved as .bak for manual recovery
      try { fs.copyFileSync(this.file, this.file + '.bak'); } catch { /* ignore */ }
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  list(): LibRecord[] {
    return this.data.installed;
  }

  find(id: string): LibRecord | null {
    return this.data.installed.find((m) => m.id === id) || null;
  }

  findByKey(categoryId: string, name: string, styleLabel?: string | null): LibRecord | null {
    return this.data.installed.find(
      (m) => m.categoryId === categoryId && m.name === name && (m.styleLabel || null) === (styleLabel || null)
    ) || null;
  }

  add({ name, categoryId, styleLabel, fileRef, preview, files, kind, members }: NewRecord): LibRecord {
    const id = crypto.randomUUID();
    const rec: LibRecord = {
      id,
      name,
      categoryId,
      styleLabel: styleLabel || null,
      fileRef,
      preview: preview || null,
      files,
      enabled: true,
      installedAt: Date.now(),
    };
    if (kind) rec.kind = kind;            // e.g. 'pack' — a combined multi-mod slot
    if (members) rec.members = members;   // pack members: [{ id, name, categoryId, enabled, ... }]
    this.data.installed.push(rec);
    this.save();
    return rec;
  }

  update(id: string, fields: Partial<LibRecord>): LibRecord | null {
    const rec = this.find(id);
    if (rec) { Object.assign(rec, fields); this.save(); }
    return rec;
  }

  setEnabled(id: string, enabled: boolean): LibRecord | null {
    const rec = this.find(id);
    if (rec) {
      rec.enabled = enabled;
      this.save();
    }
    return rec;
  }

  /* Deleting a mod does not edit anybody's builds any more.
   *
   * A preset used to hold ids of installed records, so removing a mod cut it out of every
   * preset that named it - and reinstalling did not put it back, because the reinstall is a
   * new record with a new id. A build survived exactly as long as its installation, which is
   * the opposite of what people keep them for. Presets hold the mod's own identity now (see
   * Library.identityOf), so a deleted mod is a member that is simply not installed. */
  removeRecord(id: string): void {
    this.data.installed = this.data.installed.filter((m) => m.id !== id);
    this.save();
  }

  knownLangRelPaths(): string[] {
    const out: string[] = [];
    for (const m of this.data.installed) {
      for (const f of m.files) {
        if (f.root === 'lang') out.push(f.relPath);
      }
    }
    return out;
  }

  // every installed file across all roots (lang/fonts/cursor/tools) — used to tell
  // app-managed content apart from foreign files during the foreign scan
  knownFiles(): LibFile[] {
    const out: LibFile[] = [];
    for (const m of this.data.installed) {
      for (const f of m.files) out.push({ root: f.root, relPath: f.relPath });
    }
    return out;
  }

  // ---------- presets ----------

  listPresets(): Preset[] {
    return this.data.presets;
  }

  /* A preset is a set of mods, and a free cosmetic is not one: it owns no file and no pak
   * slot, it is a pick written into the item table, and it exists only while safe mode is
   * off. Folding the two together is what made applying a build silently strip somebody's
   * courier and wards - they were never in the preset, so the apply turned them off. The
   * picks are left alone by everything here; the Library is where they are managed. */
  static inPreset(rec: Pick<LibRecord, 'categoryId'> | null | undefined): boolean {
    return !!rec && rec.categoryId !== 'cosmetic';
  }

  /* What a preset remembers about one mod: the same self-contained identity that already
   * travels inside a .d2mm (see src/preset-share.ts), so what is stored and what is shared
   * say the same thing. Not an id - an id belongs to one installation of one mod on one
   * machine, and a build outlives both. */
  static identityOf(rec: ModLike): ModIdentity {
    return {
      categoryId: rec.categoryId || 'imported',
      name: rec.name,
      styleLabel: rec.styleLabel || null,
      fp: rec.fp || null,
    };
  }

  static sameMod(identity: ModIdentity | null | undefined, rec: ModLike | null | undefined): boolean {
    if (!identity || !rec) return false;
    if (identity.fp && rec.fp) return identity.fp === rec.fp;
    return (rec.categoryId || 'imported') === identity.categoryId
      && rec.name === identity.name
      && (rec.styleLabel || null) === (identity.styleLabel || null);
  }

  savePreset(name: string): void {
    const enabled = this.data.installed.filter((m) => m.enabled && Library.inPreset(m));
    const mods = enabled.map(Library.identityOf);
    // never fold today's state into a shared preset waiting to be installed — same name,
    // completely different thing
    const existing = this.data.presets.find((p) => p.name === name && !p.wanted);
    if (existing) {
      existing.mods = mods;
      delete existing.modIds;
      existing.updatedAt = Date.now();
    } else {
      this.data.presets.push({ id: crypto.randomUUID(), name, mods, updatedAt: Date.now() });
    }
    this.save();
  }

  // Re-capture what is enabled right now into an existing preset. Saving by name meant
  // retyping it exactly to update a build, and a typo silently created a second preset.
  updatePresetMods(presetId: string): Preset | null {
    const p = this.getPreset(presetId);
    if (!p || p.wanted) return null;
    p.mods = this.data.installed.filter((m) => m.enabled && Library.inPreset(m)).map(Library.identityOf);
    delete p.modIds;
    p.updatedAt = Date.now();
    this.save();
    return p;
  }

  // A preset that arrived as a .d2mm and hasn't been installed yet: it holds the sender's
  // wish list (`wanted`) instead of local mod ids, plus where the file is stashed.
  addSharedPreset({ name, note, author, wanted, sourceFile }: {
    name: string; note?: string; author?: string; wanted: Record<string, unknown>[]; sourceFile?: string | null;
  }): Preset {
    const preset: Preset = {
      id: crypto.randomUUID(),
      name,
      modIds: [],
      updatedAt: Date.now(),
      wanted,
      source: { note: note || '', author: author || '', file: sourceFile || null, importedAt: Date.now() },
    };
    this.data.presets.push(preset);
    this.save();
    return preset;
  }

  updatePreset(id: string, fields: Partial<Preset>): Preset | null {
    const p = this.getPreset(id);
    if (p) { Object.assign(p, fields); this.save(); }
    return p;
  }

  deletePreset(presetId: string): void {
    this.data.presets = this.data.presets.filter((p) => p.id !== presetId);
    this.save();
  }

  getPreset(presetId: string): Preset | null {
    return this.data.presets.find((p) => p.id === presetId) || null;
  }

  /**
   * What a preset asks for, and whether each one is on this machine.
   *
   * Reading is where the old shape is understood rather than rewritten: a preset saved
   * before this holds ids, and turning those into identities on the way out means a
   * downgrade still finds its presets intact. Cosmetics that a pre-2.6 preset still names
   * are dropped here too, so reading gives the same answer saving again would.
   */
  presetMembers(preset: Preset | null | undefined): { identity: ModIdentity; rec: LibRecord | null }[] {
    const out: { identity: ModIdentity; rec: LibRecord | null }[] = [];
    const seen = new Set<string>();
    const push = (identity: ModIdentity, rec: LibRecord | null | undefined) => {
      const key = `${identity.categoryId}|${identity.name}|${identity.styleLabel || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ identity, rec: rec || null });
    };
    for (const identity of preset?.mods || []) {
      if (identity.categoryId === 'cosmetic') continue;
      push(identity, this.data.installed.find((r) => Library.sameMod(identity, r)));
    }
    // a preset written before builds stopped being lists of install ids
    if (!preset?.mods) {
      for (const id of preset?.modIds || []) {
        const rec = this.find(id);
        if (!rec || !Library.inPreset(rec)) continue;
        push(Library.identityOf(rec), rec);
      }
    }
    return out;
  }

  /** The installed records a preset names, for everything that works in ids. */
  presetModIds(preset: Preset | null | undefined): string[] {
    return this.presetMembers(preset).flatMap((m) => (m.rec ? [m.rec.id] : []));
  }
}

