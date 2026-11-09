/* What each channel may be handed, checked before its handler runs (src/window-guard.ts).
 *
 * TypeScript holds the window and the main process to the same shapes (renderer/api/), but only
 * while both are this app's own code. The values that arrive over IPC are whatever the page sent:
 * a page that ran a script it should not have - a mod description with markup in it, a catalog
 * entry somebody wrote to break out - could send anything, and the handlers behind these channels
 * write the game folder, open folders in Explorer, launch programs and change the settings.
 *
 * So every channel the main process answers has an entry here, and a call whose arguments do not
 * fit is refused before the handler sees it. The checks are about shape and size: a string where
 * a string goes, an id that is an id, a list that is not a million items long. What a value means
 * (whether an id is a mod in the library, whether a tool folder is one this app installed) stays
 * with the handler, which knows. Settings are the exception: the window may change only the keys
 * it has a control for, so the game folder, the Discord account and the item table's stamp are
 * not one call away from a script.
 *
 * test/window-guard.test.ts fails when a channel in src/ has no entry here, when an entry names a
 * channel that no longer exists, and when a check accepts what it is there to refuse.
 */

import { validateDownloadProxy } from './download-proxy.ts';

/** Why a value does not fit, or null when it does. */
export type Check = (v: unknown) => string | null;

/** The arcanas the arcana window builds: src/arcana-service.ts WINDOWS, which a test keeps in step. */
export const ARCANA_WINDOWS = ['terrorblade-arcana', 'techies-arcana', 'terrorblade-span', 'terrorblade-scythes', 'razor-crest'];

const fail = (what: string) => `expected ${what}`;

const str = (max: number, min = 0): Check => (v) =>
  typeof v === 'string' && v.length >= min && v.length <= max ? null : fail(`a string of ${min}-${max} characters`);
const bool: Check = (v) => (typeof v === 'boolean' ? null : fail('true or false'));
const num = (min: number, max: number): Check => (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? null : fail(`a number from ${min} to ${max}`);
const oneOf = (...allowed: unknown[]): Check => (v) => (allowed.includes(v) ? null : fail(`one of ${allowed.join(', ')}`));
const optional = (c: Check): Check => (v) => (v === undefined || v === null ? null : c(v));
const either = (...cs: Check[]): Check => (v) => (cs.some((c) => c(v) === null) ? null : cs.map((c) => c(v)).join(' or '));
const list = (of: Check, max: number): Check => (v) => {
  if (!Array.isArray(v)) return fail('a list');
  if (v.length > max) return fail(`at most ${max} items`);
  for (let i = 0; i < v.length; i++) {
    const bad = of(v[i]);
    if (bad) return `item ${i}: ${bad}`;
  }
  return null;
};
/** A plain object with these keys and no others; a key whose check allows undefined may be missing. */
const shape = (fields: Record<string, Check>): Check => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('an object');
  for (const key of Object.keys(v)) if (!(key in fields)) return `unexpected key ${key}`;
  for (const [key, c] of Object.entries(fields)) {
    const bad = c((v as Record<string, unknown>)[key]);
    if (bad) return `${key}: ${bad}`;
  }
  return null;
};
const bytes = (max: number): Check => (v) => {
  const size = v instanceof ArrayBuffer ? v.byteLength : ArrayBuffer.isView(v) ? v.byteLength : -1;
  return size >= 0 && size <= max ? null : fail(`bytes, at most ${max}`);
};
/** Anything JSON can say, up to a size: the window's own layout notes. */
const json = (max: number): Check => (v) => {
  try {
    const text = JSON.stringify(v);
    return text !== undefined && text.length <= max ? null : fail(`JSON of at most ${max} characters`);
  } catch { return fail('JSON'); }
};

const MB = 1024 * 1024;
/** A library record, preset or pack id: a UUID today, a short name in older manifests. */
const ID = str(200, 1);
const IDS = list(ID, 10000);
/** A file the user picked or dropped: any path the system allows. */
const PATH = str(4096, 1);
/** A name in the library or the catalog. */
const NAME = str(500);
/** A picture: a catalog address or a frame as a data URI. */
const PREVIEW = optional(str(16 * MB));
/** One pick of a saved look in the item builder (renderer/views/item-looks.ts). */
const HUD_PART = shape({ id: str(40, 1), scale: optional(num(60, 130)), x: optional(num(-1920, 1920)), y: optional(num(-1920, 1920)), opacity: optional(num(10, 100)), tint: optional(str(7, 7)), hidden: optional(bool) });
const EFFECT_EDITS: Check = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('an object');
  return Object.keys(v).length <= 64 ? json(16000)(v) : fail('at most 64 systems');
};
const LOOK_PICK = shape({ slot: str(200, 1), itemId: str(20, 1), name: str(500), effectId: optional(str(500)) });

/**
 * The settings the window has a control for, and what each may be set to. The rest - the game
 * folder, the language suffix, the Discord account, the item table's stamp - are set by the main
 * process from what it found or was told by Steam and Discord, never by the page.
 */
export const WINDOW_SETTINGS: Record<string, Check> = {
  discordPresence: bool,
  countDownloads: bool,
  everyoneWearsMine: bool,
  favorites: list(str(500), 20000),
  itemLooks: list(shape({ id: str(60, 1), hero: str(200, 1), name: str(80, 1), picks: list(LOOK_PICK, 40), at: num(0, 1e14) }), 2000),
  langPromptSeen: bool,
  modLabels: (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('an object');
    const entries = Object.entries(v);
    if (entries.length > 5000) return fail('at most 5000 labels');
    for (const [k, label] of entries) {
      if (!/^(rec|file):.{1,500}$/.test(k)) return `label key ${k.slice(0, 60)}: expected rec:<id> or file:<name>`;
      const bad = str(80, 1)(label);
      if (bad) return `label ${k.slice(0, 60)}: ${bad}`;
    }
    return null;
  },
  panels: either(oneOf(null), json(64 * 1024)),
  pumpkin: bool,
  pumpkinLit: bool,
  secret: bool,
  showAdult: bool,
  theme: str(40, 1),
  toolsPromptSeen: bool,
  downloadProxy: (v) => {
    const result = validateDownloadProxy(v);
    return result.ok ? null : result.error;
  },
  uiLang: (v) => (typeof v === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(v) ? null : fail('a language code')),
};

const downloadProxy: Check = (v) => {
  const result = validateDownloadProxy(v);
  return result.ok ? null : result.error;
};

// the value's check depends on the key, so checkArgs runs it once the key is known to be one
const settingsSet: Check[] = [
  (key) => (typeof key === 'string' && Object.hasOwn(WINDOW_SETTINGS, key) ? null : `the window may not set ${String(key).slice(0, 60)}`),
  () => null,
];

/** Each channel's arguments, in order. A channel that takes none has an empty list. */
export const CHANNEL_ARGS: Record<string, Check[]> = {
  // the window and the app (src/ipc-window.ts, src/main.ts)
  'win:minimize': [], 'win:maximize': [], 'win:close': [], 'win:isMaximized': [],
  'app:version': [], 'app:notes': [str(16)], 'app:notesSeen': [], 'app:stars': [],
  'update:install': [], 'update:fetchPortable': [], 'update:revealPortable': [PATH],
  'beta:state': [], 'beta:set': [bool],
  'game:launch': [], 'game:steamDownloads': [], 'game:steamProperties': [],
  'grid:state': [], 'grid:apply': [list(oneOf('winrate', 'attribute', 'popular'), 3)], 'grid:remove': [],
  'ui:setZoom': [num(0.25, 5)],
  // settings and the account (src/ipc-settings.ts)
  'settings:get': [], 'settings:set': settingsSet, 'settings:testProxy': [downloadProxy], 'settings:detectDota': [], 'settings:browseDota': [],
  'settings:moveLangFiles': [optional(str(64))],
  'presence:view': [str(64)],
  'support:state': [], 'support:choose': [oneOf('later', 'done')],
  'account:signIn': [], 'account:signOut': [],
  'catalog:load': [optional(bool)], 'catalog:terrainAges': [], 'catalog:downloadCounts': [],
  // mods (src/ipc-mods.ts, src/ipc-library.ts, src/ipc-foreign.ts)
  // a stuck font or cursor is reinstalled from its record, whose category the handler judges
  'mods:install': [shape({ categoryId: str(100), name: NAME, styleLabel: optional(NAME), fileRef: optional(str(1000)), preview: PREVIEW })],
  'mods:list': [], 'mods:update': [ID], 'mods:switchOffStaleTerrains': [], 'mods:clearPrePatch': [ID],
  'mods:importDialog': [], 'mods:importFolderDialog': [],
  'mods:importPaths': [list(PATH, 10000)],
  'mods:importBuffers': [list(shape({ name: str(1000, 1), data: bytes(4096 * MB) }), 1000)],
  'mods:exportSingle': [ID], 'mods:unpackToFolder': [ID],
  'mods:masterState': [], 'mods:setMaster': [bool],
  'mods:setEnabled': [ID, bool], 'mods:setEnabledMany': [IDS, bool],
  'mods:remove': [ID], 'mods:removeMany': [IDS],
  'mods:move': [ID, num(-1, 1)], 'mods:reorder': [ID, num(0, 10000)],
  'mods:mapsOwner': [],
  'mods:externalSetEnabled': [PATH, bool], 'mods:externalRemove': [PATH],
  'mods:splitMod': [ID], 'mods:splitExternal': [PATH],
  'mods:adoptMod': [ID, PREVIEW], 'mods:adoptExternal': [PATH, PREVIEW], 'mods:adoptFont': [NAME, PREVIEW], 'mods:adoptCursor': [PREVIEW],
  // combined packs (src/ipc-packs.ts)
  'packs:combine': [shape({ name: NAME, modIds: IDS })],
  'packs:addMembers': [ID, IDS], 'packs:setMemberEnabled': [ID, ID, bool], 'packs:removeMember': [ID, ID],
  'packs:extractMembers': [ID, IDS], 'packs:disband': [ID],
  // presets (src/ipc-presets.ts)
  'presets:list': [], 'presets:save': [NAME], 'presets:update': [ID], 'presets:rename': [ID, NAME], 'presets:delete': [ID],
  'presets:apply': [ID], 'presets:resolve': [ID], 'presets:exportPlan': [ID], 'presets:shareLink': [ID],
  'presets:export': [ID, optional(shape({ skip: optional(list(str(1000), 10000)), author: optional(str(200)), note: optional(str(5000)) }))],
  'presets:importDialog': [], 'presets:importFile': [PATH], 'presets:ready': [], 'presets:takeReady': [ID],
  // the game: its schema, cosmetics, pictures, tools (src/ipc-game.ts)
  'config:state': [], 'config:noticeSeen': [str(200, 1)],
  'patch:state': [], 'patch:repairState': [], 'patch:repairNow': [], 'patch:repairApp': [], 'patch:repairSeen': [], 'patch:setEnabled': [bool],
  'schema:refresh': [],
  'schema:cancel': [],
  'cosmetics:slots': [],
  'cosmetics:heroPortraits': [list(either(str(100), num(0, 1e9)), 1000), optional(bool)],
  'cosmetics:heroPortraitsByName': [list(str(200), 1000)],
  'cosmetics:icons': [list(str(500), 20000)],
  'cosmetics:pick': [str(100, 1), either(str(100), num(0, 1e9)), optional(NAME), optional(either(str(100), num(0, 1e9)))],
  'cosmetics:pickSet': [either(str(100, 1), num(0, 1e9)), optional(num(0, 64))],
  'cosmetics:wearLook': [str(200, 1), list(LOOK_PICK, 40)],
  'preview:video': [str(500, 1)], 'preview:frame': [str(500, 1), bytes(32 * MB)],
  'tools:state': [], 'tools:install': [str(100, 1)], 'tools:remove': [str(100, 1)],
  // resourcecompiler.exe (src/ipc-compiler.ts): its path comes from a dialog, never from here
  'compiler:state': [], 'compiler:browse': [], 'compiler:forget': [], 'compiler:prepare': [], 'compiler:check': [], 'compiler:keep': [], 'compiler:removeKept': [],
  'sounds:heroes': [],
  // the 3D preview: a hero and its slots, each with the stock item it dresses (src/hero-preview.ts)
  'preview3d:warm': [str(80, 1), list(shape({ slot: str(120, 1), stock: str(20, 1) }), 40)],
  'preview3d:prefetch': [str(80, 1), list(shape({ slot: str(120, 1), stock: str(20, 1) }), 40), str(120, 1), list(str(20, 1), 400)],
  'preview3d:models': [str(80, 1), list(shape({ slot: str(120, 1), stock: str(20, 1), tryOn: optional(shape({ itemId: str(20), effectId: str(500) })) }), 40)], 'preview3d:slice': [num(1, Number.MAX_SAFE_INTEGER), num(0, Number.MAX_SAFE_INTEGER)], 'preview3d:motions': [str(200, 1)], 'preview3d:effect': [str(40, 1)], 'preview3d:model': [str(200, 1)], 'sounds:hero': [str(60, 1)], 'sounds:remove': [str(60, 1), str(200, 1)],
  'sounds:add': [str(60, 1), str(200, 1), oneOf('replace', 'layer'), num(0.05, 1), bytes(8 * MB), str(200)],
  // the menu's background (src/ipc-background.ts): a WebM the window encoded, or null for a new look alone
  // the in-game HUD's layout (src/ipc-hud.ts): what src/hud-scale.ts cleanParts then puts in range
  'hud:state': [], 'hud:install': [list(HUD_PART, 11)],
  // the effect editor (src/ipc-effects.ts): src/effect-edit.ts cleanEdits keeps what it knows of the changes
  'fx:search': [str(200)], 'fx:heroes': [], 'fx:hero': [str(40, 2)], 'fx:load': [str(300, 1)], 'fx:preview': [str(300, 1), EFFECT_EDITS], 'fx:install': [str(300, 1), EFFECT_EDITS, optional(bool)],
  // the author's drafts (src/ipc-creator.ts): the files come from a dialog, never from here
  'creator:list': [], 'creator:remove': [ID], 'creator:export': [ID, optional(list(optional(bytes(8 * MB)), 3))],
  'creator:save': [optional(ID), shape({
    name: optional(str(500)), category: optional(str(60)), hero: optional(str(60)), description: optional(str(5000)), author: optional(str(200)),
    replaces: optional(shape({ category: str(60, 1), name: str(500, 1) })), styles: optional(list(shape({ label: str(200) }), 12)),
  })],
  'creator:attach': [ID, num(0, 11), oneOf('vpk', 'picture')],
  'rank:state': [], 'rank:pictures': [], 'rank:install': [json(64 * 1024)],
  // the map without its decor (src/ipc-decor.ts): the groups taken off
  'decor:state': [], 'decor:install': [list(oneOf('plants', 'debris'), 2)],
  'background:state': [], 'background:install': [optional(bytes(48 * MB)), optional(str(200)), num(0, 0.9), num(0, 20)],
  // a hero's ability icons from his own cosmetics' (src/ipc-icons.ts): his npc name, an ability, an icon under spellicons or null for the game's
  'icons:heroes': [], 'icons:hero': [str(40, 2)], 'icons:pictures': [list(str(160, 1), 200)],
  'icons:set': [str(40, 2), str(100, 1), optional(str(160, 1))], 'icons:clear': [str(40, 2)],
  // a hero recoloured part by part (src/ipc-paint.ts): his npc name, and a #rrggbb per layer that is on
  'paint:state': [str(40, 2), optional(list(str(12), 24))], 'paint:icons': [list(str(100), 60)], 'paint:install': [str(40, 2), json(64 * 1024), optional(str(80)), optional(list(str(12), 24))],
  'map:state': [], 'map:install': [oneOf('towers', 'trees'), optional(str(40)), optional(str(40))],
  'arcana:state': [], 'arcana:install': [oneOf(...ARCANA_WINDOWS), list(num(0, 255), 3), oneOf('mod', 'recolor')],
  // the small errands (src/ipc-misc.ts)
  'misc:openLangFolder': [], 'misc:openCacheFolder': [], 'misc:openToolsFolder': [optional(str(260, 1))],
  'misc:openExternal': [optional((v) => {
    if (typeof v !== 'string' || v.length > 4096) return fail('an address');
    try { return /^https?:$/.test(new URL(v).protocol) ? null : fail('an http or https address'); } catch { return fail('an address'); }
  })],
  'misc:cacheSize': [], 'misc:clearCache': [], 'misc:cacheList': [], 'misc:cacheRemove': [str(520, 1)], 'misc:runTool': [str(260, 1)],
  // the pumpkin's key (src/ipc-pumpkin.ts)
  'pumpkin:redeem': [str(80)], 'pumpkin:prizeAgain': [], 'pumpkin:hasPrize': [],
  // diagnostics (src/ipc-diagnostics.ts)
  // the handler keeps the first 2000 characters: a long error is cut there, not refused here
  'diag:export': [], 'diag:rendererError': [str(4 * MB)],
  // the removal window (src/uninstall-window.ts)
  // the window sends all three boxes (renderer/uninstall.js); the uninstaller acts on data itself
  'uninstall:plan': [], 'uninstall:run': [optional(shape({ revert: optional(bool), mods: optional(bool), data: optional(bool) }))],
  'uninstall:done': [bool], 'uninstall:cancel': [],
};

/**
 * Check one call. Fewer arguments than the channel takes is fine when the missing ones are
 * optional; more is not, because no caller in the window sends them.
 */
export function checkArgs(channel: string, args: unknown[]): string | null {
  const checks = CHANNEL_ARGS[channel];
  if (!checks) return `no argument check for ${channel}`;
  if (args.length > checks.length) return `${channel} takes ${checks.length} argument(s), got ${args.length}`;
  for (let i = 0; i < checks.length; i++) {
    const bad = checks[i](args[i]);
    if (bad) return `${channel} argument ${i + 1}: ${bad}`;
  }
  if (channel === 'settings:set') {
    const bad = WINDOW_SETTINGS[args[0] as string](args[1]);
    if (bad) return `settings:set ${String(args[0])}: ${bad}`;
  }
  return null;
}
