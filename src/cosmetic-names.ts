// Display names come from Valve's installed localization, while schema names remain the keys
// used by icons, saved picks and the item builder. No translated name is written into the schema.
import path from 'path';
import { openVpkIndex } from './vpk.ts';
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

let cached: { game: string; stamp: string; names: Record<string, string> } | null = null;

/** Read-only, offline and refreshed after a game update; a missing language file keeps English. */
export function chineseCosmeticNames(game: string, schemaText: string): Record<string, string> {
  try {
    const stamp = gameSchemaStamp(game);
    if (cached?.game === game && cached.stamp === stamp) return cached.names;
    const index = openVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    const tokens = new Map<string, string>();
    for (const file of ['dota', 'items']) {
      const data = index.read(`resource/localization/${file}_schinese.txt`);
      if (data) for (const [key, value] of localizationTokens(data)) tokens.set(key, value);
    }
    const names = cosmeticNameTable(listItems(schemaText), tokens);
    cached = { game, stamp, names };
    return names;
  } catch { return {}; }
}
