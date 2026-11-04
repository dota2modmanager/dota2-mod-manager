/**
 * The ready-made presets (config/presets.json, the list the app's Presets screen offers), read when
 * the site is built: each with the catalog's pictures for its mods and the link the app opens, in
 * the format src/preset-link.ts decodes. The site check (test/) decodes these links with the app's
 * own decoder, so a list the app cannot read does not get published.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { REPO_ROOT } from './paths';
import { catalog, type CatalogMod } from './catalog';

export interface ReadyPreset {
  id: string;
  name: { en: string; ru: string };
  about: { en: string; ru: string };
  mods: Array<{ cat: string; name: string; style: string | null; mod: CatalogMod | null }>;
  /** the preset's code under each language's name: d2mm://preset/<code> opens it in the app, /p/#<code> shows it */
  code: { en: string; ru: string };
}

type Raw = { id: string; ru?: string; en?: string; about?: { ru?: string; en?: string }; mods: Array<{ category: string; name: string; style?: string }> };

const byName = new Map(catalog.map((m) => [`${m.cat}|${m.name.toLowerCase()}`, m]));

/** The same payload the app writes: short keys, mods as [category, name, style?], deflate, base64url. */
export function codeOf(name: string, mods: Array<{ cat: string; name: string; style: string | null }>): string {
  const payload = { v: 1, n: name.slice(0, 120), m: mods.map((m) => (m.style ? [m.cat, m.name, m.style] : [m.cat, m.name])) };
  return zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf-8'), { level: 9 }).toString('base64url');
}

function load(): ReadyPreset[] {
  let raw: { presets?: Raw[] };
  try { raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'presets.json'), 'utf-8')); } catch { return []; }
  return (raw.presets || []).map((p) => {
    const mods = p.mods.map((m) => ({ cat: m.category, name: m.name, style: m.style || null, mod: byName.get(`${m.category}|${m.name.toLowerCase()}`) ?? null }));
    const en = p.en || p.ru || p.id;
    return {
      id: p.id,
      name: { en, ru: p.ru || en },
      about: { en: p.about?.en || '', ru: p.about?.ru || p.about?.en || '' },
      mods,
      // the app shows a preset under the name its link carries, so each page's link carries its own
      code: { en: codeOf(en, mods), ru: codeOf(p.ru || en, mods) },
    };
  });
}

export const readyPresets: ReadyPreset[] = load();
