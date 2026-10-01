// Shareable preset files (.d2mm) — a zip holding preset.json plus the VPK of every mod
// the receiving app can't just fetch for itself.
//
// A catalog mod is stored as an identity (categoryId + name + styleLabel), never as a URL:
// the download filename changes whenever the catalog author renames something, but the
// identity is the same triple the app already keys installed mods by. A fingerprint rides
// along so the receiver can tell it's the same build and can still recognise the mod if it
// was renamed upstream. Only a mod with no catalog identity (a user's own import) has to
// travel as bytes — and that is always exactly one self-contained VPK.
//
// Everything here treats the file as hostile input: it arrives from a stranger over
// Discord. Nothing is read out of the zip that the manifest didn't ask for by an exact,
// pattern-checked name, and the caller installs only after showing the user the contents.
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { openZip, type OpenedZip } from './safe-zip.ts';
import { t } from './i18n.ts';

import type { PresetEntry } from './types.ts';

export type { PresetEntry };

/** preset.json once it has been checked: everything a receiver is shown before installing. */
export interface PresetManifest {
  format: string; version: number; name: string; note: string; author: string;
  createdAt: number | null; app: string; catalogFetchedAt: number | null; mods: PresetEntry[];
}

/** A line to write. An embedded mod carries its bytes in `data`, and they go into the zip in its place. */
export interface EntryToWrite { kind: string; name: string; data?: Buffer; members?: EntryToWrite[]; [key: string]: unknown }

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object';
const finite = (v: unknown): v is number => Number.isFinite(v);

/** What preset.json says it is, so a stray zip is not taken for a preset. */
export const FORMAT = 'dota2-mod-manager/preset';
/** The newest format this build writes and can read. */
export const VERSION = 1;
const MANIFEST_NAME = 'preset.json';
const MAX_MANIFEST_BYTES = 1 << 20;   // a manifest is KBs; a megabyte is already absurd
/** More mods than anybody has; a list longer than this is refused before it is read. */
export const MAX_MODS = 500;
const MOD_FILE_RE = /^mods\/[A-Za-z0-9_-]{1,64}\.vpk$/;

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '');
const modPath = (i: number) => `mods/${String(i).padStart(3, '0')}.vpk`;

// One mod line of the manifest. Unknown kinds and entries missing what their kind needs
// are dropped rather than half-trusted.
function normalizeEntry(raw: unknown, { allowPack = true } = {}): PresetEntry | null {
  if (!isObject(raw)) return null;
  const name = str(raw.name);
  if (!name) return null;

  if (raw.kind === 'catalog') {
    const categoryId = str(raw.categoryId, 60);
    if (!categoryId) return null;
    return { kind: 'catalog', categoryId, name, styleLabel: str(raw.styleLabel) || null, fp: str(raw.fp, 64) || null };
  }
  if (raw.kind === 'embedded') {
    const file = str(raw.file, 128);
    if (!MOD_FILE_RE.test(file)) return null;
    return {
      kind: 'embedded', name, file, categoryId: str(raw.categoryId, 60) || 'imported',
      size: finite(raw.size) ? raw.size : 0, fp: str(raw.fp, 64) || null, info: str(raw.info),
    };
  }
  // a free cosmetic pick: slot + item id from the sender's game schema, no bytes at all
  if (raw.kind === 'cosmetic') {
    const slot = str(raw.slot, 60);
    const itemId = str(raw.itemId, 20);
    if (!slot || !itemId) return null;
    return { kind: 'cosmetic', name, slot, itemId, effectId: str(raw.effectId, 60) };
  }
  if (raw.kind === 'pack' && allowPack) {
    const members = (Array.isArray(raw.members) ? raw.members : [])
      .map((m) => normalizeEntry(m, { allowPack: false }))
      .filter((m): m is PresetEntry => m !== null);
    return { kind: 'pack', name, members };
  }
  // the sender knowingly left this one out — carried so the receiver sees what's absent
  if (raw.kind === 'missing') return { kind: 'missing', name, reason: str(raw.reason) };
  return null;
}

/** preset.json checked field by field: what fails is refused, what is unknown is dropped. */
export function validateManifest(raw: unknown): PresetManifest {
  if (!isObject(raw)) throw new Error(t('preset.json повреждён'));
  if (raw.format !== FORMAT) throw new Error(t('Это не файл пресета Mod Manager'));
  if (!((raw.version as number) <= VERSION)) throw new Error(t('Файл собран более новой версией приложения'));
  if (!Array.isArray(raw.mods)) throw new Error(t('preset.json повреждён'));
  if (raw.mods.length > MAX_MODS) throw new Error(t('Слишком много модов в пресете'));
  const mods = raw.mods.map((m) => normalizeEntry(m)).filter((m): m is PresetEntry => m !== null);
  return {
    format: FORMAT,
    version: raw.version as number,
    name: str(raw.name, 120) || t('Пресет'),
    note: str(raw.note, 600),
    author: str(isObject(raw.author) ? raw.author.name : undefined, 80),
    createdAt: finite(raw.createdAt) ? raw.createdAt : null,
    app: str(raw.app, 20),
    catalogFetchedAt: finite(raw.catalogFetchedAt) ? raw.catalogFetchedAt : null,
    mods,
  };
}

/**
 * Write a .d2mm: the manifest, and the bytes of every embedded mod beside it.
 * @param outPath   where to write the .d2mm
 * @param manifest  everything but `mods` (name/note/author/app…)
 * @param entries   mod lines; embedded ones carry a `data` Buffer
 */
export function writePresetFile(outPath: string, manifest: Record<string, unknown>, entries: EntryToWrite[]): { path: string; size: number; mods: EntryToWrite[] } {
  const zip = new AdmZip();
  let n = 0;
  const place = (entry: EntryToWrite): EntryToWrite => {
    if (entry.kind !== 'embedded') return entry;
    const file = modPath(n++);
    zip.addFile(file, entry.data as Buffer);
    const { data, ...rest } = entry;
    return { ...rest, file, size: (data as Buffer).length };
  };
  const mods = entries.map((e) => (e.kind === 'pack'
    ? { ...e, members: (e.members as EntryToWrite[]).map(place) }
    : place(e)));

  const full = { format: FORMAT, version: VERSION, createdAt: Date.now(), ...manifest, mods };
  zip.addFile(MANIFEST_NAME, Buffer.from(JSON.stringify(full, null, 2), 'utf-8'));
  zip.writeZip(outPath);
  return { path: outPath, size: fs.statSync(outPath).size, mods };
}

/**
 * Parse and validate a .d2mm.
 */
export function readPresetFile(filePath: string): { manifest: PresetManifest; readMod: (file: string) => Buffer } {
  let archive: OpenedZip;
  // a refusal from safe-zip carries the reason the file was turned down and is kept as is;
  // anything else means adm-zip could not make sense of the bytes at all
  try { archive = openZip(filePath); } catch (err) {
    if ((err as { safeZip?: boolean } | null)?.safeZip) throw err;
    throw new Error(t('Файл не открывается как пресет'));
  }
  const head = archive.get(MANIFEST_NAME);
  if (!head) throw new Error(t('Это не файл пресета Mod Manager'));
  if (head.size > MAX_MANIFEST_BYTES) throw new Error(t('preset.json повреждён'));
  let raw: unknown;
  try { raw = JSON.parse(head.read().toString('utf-8')); } catch { throw new Error(t('preset.json повреждён')); }
  const manifest = validateManifest(raw);

  // an embedded line whose payload isn't actually in the zip becomes a "missing" line,
  // so one broken entry costs its own mod and not the whole preset
  const present = new Set(archive.files.map((f) => f.path));
  const check = (e: PresetEntry): PresetEntry => (e.kind === 'embedded' && !present.has(e.file)
    ? { kind: 'missing', name: e.name, reason: t('файла нет в архиве') }
    : e);
  manifest.mods = manifest.mods.map((e) => (e.kind === 'pack' ? { ...e, members: e.members.map(check) } : check(e)));

  return {
    manifest,
    readMod(file: string) {
      if (!MOD_FILE_RE.test(file)) throw new Error(t('Недопустимое имя файла в архиве'));
      const entry = archive.get(file);
      if (!entry) throw new Error(t('файла нет в архиве'));
      return entry.read();
    },
  };
}

