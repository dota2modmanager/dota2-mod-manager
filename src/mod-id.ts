// What a mod actually replaces, asked of the game instead of guessed from folder names.
//
// Until now a mod was read by its paths: the folder under models/ was taken for a hero, and
// the words in a model's file name for an equip slot. That works often and fails in ways the
// user sees. Authors borrow generic lookup textures (fresnel, colourwarp, detail masks) out
// of other heroes' folders, and every borrowed file counted as another hero - one real set
// came out as "Bundle of 8 heroes" when it dresses exactly one. Measured over 84 installed
// mods: 12 heroes invented across 5 mods.
//
// The game can simply be asked. Its item table says where each cosmetic's model lives
// (`model_player`) and who wears it (`used_by_heroes`), so a mod that overrides that path is
// replacing that item, by name. Over the same 84 mods the table can speak for 37, agrees
// with the guess on 32, and corrects it on 5.
//
// This needs no toolchain - items_game.txt is plain text inside the game's own pak and our
// reader has always been able to get it. Without a game path there is simply no answer and
// the caller keeps the guess.
import * as schema from './schema.ts';
import { heroDisplayName } from './vpk.ts';

/** A cosmetic of the game's own, as a model file leads to it. */
type ItemRef = { name: string; slot: string; heroes: string[] };

/** Which of the game's items a mod replaces; see identify. */
export interface ModIdentityGuess { items: string[]; slots: string[]; heroNames: string[] }

/**
 * @param {object} deps
 * @param {() => string|null} deps.getGamePath
 * @param {(msg: string) => void} [deps.log]
 */
/** Names a mod by the game's own items it replaces, read out of the installed item table. */
export function createModIdentity({ getGamePath, log = () => {} }: { getGamePath: () => string | null; log?: (msg: string) => void }) {
  let index: Map<string, ItemRef[]> | null = null;      // "models/items/…/x.vmdl" -> [{ name, slot, heroes }]
  let indexStamp: string | null = null; // which build of the game it was built from
  let lastUnreadable: string | null = null; // the last complaint made, so it is not repeated per record

  /**
   * Every cosmetic the game knows, keyed by the model file it owns. Walking 25k item blocks
   * costs about half a second, so it is built once per build of the game.
   */
  function build(): Map<string, ItemRef[]> | null {
    const game = getGamePath();
    if (!game) return null;
    let stamp: string | null = null;
    try { stamp = schema.gameSchemaStamp(game); } catch { /* unreadable: rebuild every time */ }
    if (index && stamp && stamp === indexStamp) return index;
    let text: string;
    try { ({ text } = schema.readGameSchema(game)); } catch (err) {
      // Once per reason, not once per mod. This is called for every record in the library, so
      // a missing item table wrote the same line a thousand times: a support report of 166 KB
      // in which the one useful sentence was hidden by its own repetitions.
      const why = String((err as Error)?.message || err);
      if (why !== lastUnreadable) {
        lastUnreadable = why;
        log(`mod id: item table unreadable (${why})`);
      }
      return null;
    }
    const map = new Map<string, ItemRef[]>();
    for (const item of schema.listItems(text)) {
      const block = text.slice(item.start, item.end);
      const model = /"model_player"\s+"([^"]+)"/i.exec(block);
      if (!model || !item.name) continue;
      const key = model[1].toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
      const heroes = [...block.matchAll(/"(npc_dota_hero_[a-z0-9_]+)"\s+"1"/gi)]
        .map((m) => m[1].slice('npc_dota_hero_'.length).toLowerCase());
      // the table is read as latin1 to keep byte offsets exact, so names with accents and
      // curly quotes are raw UTF-8 until something shows them to a person
      const entry = { name: schema.toUtf8(item.name), slot: item.slot || '', heroes };
      const known = map.get(key);
      if (!known) map.set(key, [entry]); else known.push(entry);
    }
    index = map;
    indexStamp = stamp;
    log(`mod id: ${map.size} model paths lead to a named item`);
    return index;
  }

  function ready(): boolean {
    return !!getGamePath();
  }

  /**
   * Which of the game's own items this mod replaces.
   * @param paths lowercased inner VPK paths
   * @returns null when the game cannot be asked or recognises nothing here, which is not a failure:
   *   a mod may replace a hero's bare body, particles or sounds, and own no item at all.
   */
  function identify(paths: Iterable<string>): ModIdentityGuess | null {
    const map = build();
    if (!map) return null;
    const items = new Set<string>();
    const slots = new Set<string>();
    const heroes = new Set<string>();
    for (const p of paths) {
      if (!p.endsWith('.vmdl_c')) continue;
      // the table names the source file; the archive carries the compiled one
      for (const it of map.get(p.slice(0, -2)) || []) {
        items.add(it.name);
        if (it.slot) slots.add(it.slot);
        for (const h of it.heroes) heroes.add(h);
      }
    }
    if (!items.size) return null;
    return {
      items: [...items].sort((a, b) => a.localeCompare(b)),
      slots: [...slots],
      heroNames: [...heroes].map((h) => heroDisplayName(h)),
    };
  }

  function clear(): void {
    index = null;
    indexStamp = null;
  }

  return { identify, ready, clear };
}

