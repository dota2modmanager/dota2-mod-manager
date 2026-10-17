// Display names come from Valve's installed localization, while schema names remain the keys
// used by icons, saved picks and the item builder. No translated name is written into the schema.
import path from 'path';
import { sharedVpkIndex } from './vpk.ts';
import { drain, PAUSE } from './steps.ts';
import { gameSchemaStamp, listItems, toUtf8, type SchemaItem } from './schema.ts';

/** Valve localization files are UTF-8 today; older loose copies may carry a UTF-16 BOM. */
export function localizationTokens(data: Buffer): Map<string, string> {
  const text = data.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ? data.toString('utf16le') : data.toString('utf8');
  const tokens = new Map<string, string>();
  const quoted = /\/\/[^\r\n]*|"((?:\\.|[^"\\])*)"/g;
  const decode = (s: string) => s.replace(/\\(["\\nrt])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' }[c] || c));
  const words: string[] = [];
  for (const m of text.matchAll(quoted)) if (m[1] !== undefined) words.push(decode(m[1]));
  const at = words.findIndex((s) => s.toLowerCase() === 'tokens');
  if (at < 0) return tokens;
  for (let i = at + 1; i + 1 < words.length; i += 2) tokens.set(words[i].toLowerCase(), words[i + 1]);
  return tokens;
}

/** Resolve by item_name token, never by guessing a translation from the English title. */
export function cosmeticNameTable(items: Pick<SchemaItem, 'name' | 'itemName'>[], tokens: Map<string, string>): Record<string, string> {
  const names: Record<string, string> = Object.create(null);
  const ambiguous = new Set<string>();
  for (const item of items) {
    const name = toUtf8(item.name);
    const translated = tokens.get(item.itemName.replace(/^#/, '').toLowerCase());
    if (!name || !translated || translated.startsWith('#') || ambiguous.has(name)) continue;
    if (names[name] && names[name] !== translated) { delete names[name]; ambiguous.add(name); }
    else names[name] = translated;
  }
  return names;
}

const LANG_FILE: Record<string, string> = { ru: 'russian', en: 'english', 'zh-CN': 'schinese' };
let styleCache: { key: string; tokens: Map<string, string> } | null = null;

/**
 * An item style's name in the app's language, from the game's own localization by the style's
 * token (#DOTA_Style_Bladeform_Legacy_1); "Стиль 2" for a token the game has no text for.
 * @param lang  the app's language (src/i18n.ts getLang)
 */
export function styleNamer(game: string, lang: string, fallback: (index: number) => string): (token: string, index: number) => string {
  let tokens = new Map<string, string>();
  try {
    const key = `${game}|${gameSchemaStamp(game)}|${lang}`;
    if (styleCache?.key !== key) {
      // style names are in dota_*.txt (DOTA_Style_Bracers_of_the_Cavern_Luminar_0), items_*.txt has a few more
      const index = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
      const found = new Map<string, string>();
      for (const file of ['dota', 'items']) {
        const data = index.read(`resource/localization/${file}_${LANG_FILE[lang] || 'english'}.txt`);
        if (data) for (const [k, v] of localizationTokens(data)) if (!found.has(k)) found.set(k, v);
      }
      styleCache = { key, tokens: found };
    }
    tokens = styleCache.tokens;
  } catch { /* no game to read: every style by its number */ }
  return (token, index) => {
    const text = tokens.get(token.replace(/^#/, '').toLowerCase());
    return text && !text.startsWith('#') ? text : fallback(index);
  };
}

let cached: { game: string; stamp: string; names: Record<string, string> } | null = null;

/** Read-only, offline and refreshed after a game update; a missing language file keeps English. */
export function chineseCosmeticNames(game: string, schemaText: string): Record<string, string> {
  return drain(chineseCosmeticNamesSteps(game, schemaText));
}

/** chineseCosmeticNames, a pause after each of the two language files and before the table. */
export function* chineseCosmeticNamesSteps(game: string, schemaText: string): Generator<typeof PAUSE, Record<string, string>> {
  try {
    const stamp = gameSchemaStamp(game);
    if (cached?.game === game && cached.stamp === stamp) return cached.names;
    const index = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    const tokens = new Map<string, string>();
    for (const file of ['dota', 'items']) {
      const data = index.read(`resource/localization/${file}_schinese.txt`);
      if (data) for (const [key, value] of localizationTokens(data)) tokens.set(key, value);
      yield PAUSE;
    }
    const names = cosmeticNameTable(listItems(schemaText), tokens);
    cached = { game, stamp, names };
    return names;
  } catch { return {}; }
}
