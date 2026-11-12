// The ready-made presets' format (config/presets.json, issue #391): a short list of builds picked
// from the catalog, shown in the Presets screen and on the site. It lives beside the remote config
// and is signed with the same key, so the list changes without a release and a proxy cannot put a
// build of its own choosing in front of people.
//
// Shape:
//   {
//     "version": 1,
//     "presets": [ { "id": "minimal", "ru": "Минимализм", "en": "Minimal",
//                    "about": { "ru": "…", "en": "…" },
//                    "mods": [ { "category": "terrains", "name": "Dark Terrain Minify" },
//                              { "category": "huds", "name": "Hud Fernando", "style": "gray" } ] } ]
//   }
//
// A mod is named the way the catalog files it, as a preset link names it (src/preset-link.ts), so
// a list entry is readable in a pull request and the site turns it into a link the app opens.
// Only catalog mods: a look from the game's item table needs safe mode off, and a ready preset
// should work for everybody who presses its button.

/** A short list, read by people: more than this is a sign the file was not edited by one. */
export const MAX_PRESETS = 30;
/** Mods in one ready preset at most. */
export const MAX_MODS = 60;
const MAX_TEXT = 300;

/** A catalog mod as a ready preset names it. */
export interface ReadyMod { categoryId: string; name: string; styleLabel: string | null }

/** One ready preset, as far as it passed the checks below. */
export interface ReadyPreset {
  id: string;
  ru: string;
  en: string;
  about: { ru: string; en: string };
  mods: ReadyMod[];
}

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The fetched JSON cut down to presets with an id, a name and at least one mod; the rest is dropped. */
export function normalizeReady(raw: unknown): ReadyPreset[] {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.presets)) return [];
  const seen = new Set<string>();
  const out: ReadyPreset[] = [];
  for (const p of raw.presets.slice(0, MAX_PRESETS)) {
    if (!isObject(p)) continue;
    const id = str(p.id, 60);
    if (!/^[a-z0-9-]+$/.test(id) || seen.has(id)) continue;
    const ru = str(p.ru, 80);
    const en = str(p.en, 80);
    if (!ru && !en) continue;
    const about = isObject(p.about) ? p.about : {};
    const mods = (Array.isArray(p.mods) ? p.mods.slice(0, MAX_MODS) : [])
      .filter(isObject)
      .map((m) => ({ categoryId: str(m.category, 60), name: str(m.name), styleLabel: str(m.style) || null }))
      .filter((m) => m.categoryId && m.name);
    if (!mods.length) continue;
    seen.add(id);
    out.push({ id, ru: ru || en, en: en || ru, about: { ru: str(about.ru), en: str(about.en) }, mods });
  }
  return out;
}
