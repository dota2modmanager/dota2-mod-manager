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

/** Why a value does not fit, or null when it does. */
export type Check = (v: unknown) => string | null;

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

/**
 * The settings the window has a control for, and what each may be set to. The rest - the game
 * folder, the language suffix, the Discord account, the item table's stamp - are set by the main
 * process from what it found or was told by Steam and Discord, never by the page.
 */
export const WINDOW_SETTINGS: Record<string, Check> = {
  discordPresence: bool,
  favorites: list(str(500), 20000),
  langPromptSeen: bool,
  panels: either(oneOf(null), json(64 * 1024)),
  showAdult: bool,
  theme: str(40, 1),
  toolsPromptSeen: bool,
  uiLang: (v) => (typeof v === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(v) ? null : fail('a language code')),
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
  'app:version': [], 'app:notes': [str(16)], 'app:notesSeen': [],
  'update:install': [], 'update:fetchPortable': [], 'update:revealPortable': [PATH],
  'beta:state': [], 'beta:set': [bool],
  'game:launch': [],
  'ui:setZoom': [num(0.25, 5)],
  // settings and the account (src/ipc-settings.ts)
  'settings:get': [], 'settings:set': settingsSet, 'settings:detectDota': [], 'settings:browseDota': [],
  'settings:moveLangFiles': [optional(str(64))],
  'presence:view': [str(64)],
  'account:signIn': [], 'account:signOut': [],
  'catalog:load': [optional(bool)], 'catalog:terrainAges': [],
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
  'presets:importDialog': [], 'presets:importFile': [PATH],
  // the game: its schema, cosmetics, pictures, tools (src/ipc-game.ts)
  'config:state': [], 'config:noticeSeen': [str(200, 1)],
  'patch:state': [], 'patch:repairState': [], 'patch:repairNow': [], 'patch:repairSeen': [], 'patch:setEnabled': [bool],
  'schema:refresh': [],
  'cosmetics:slots': [],
  'cosmetics:heroPortraits': [list(either(str(100), num(0, 1e9)), 1000)],
  'cosmetics:heroPortraitsByName': [list(str(200), 1000)],
  'cosmetics:icons': [list(str(500), 20000)],
  'cosmetics:pick': [str(100, 1), either(str(100), num(0, 1e9)), optional(NAME), optional(either(str(100), num(0, 1e9)))],
  'cosmetics:pickSet': [either(str(100, 1), num(0, 1e9))],
  'preview:video': [str(500, 1)], 'preview:frame': [str(500, 1), bytes(32 * MB)],
  'tools:state': [], 'tools:install': [str(100, 1)], 'tools:remove': [str(100, 1)],
  'arcana:state': [], 'arcana:install': [list(num(0, 255), 3), oneOf('mod', 'recolor')],
  // the small errands (src/ipc-misc.ts)
  'misc:openLangFolder': [], 'misc:openToolsFolder': [optional(str(260, 1))],
  'misc:openExternal': [optional((v) => {
    if (typeof v !== 'string' || v.length > 4096) return fail('an address');
    try { return /^https?:$/.test(new URL(v).protocol) ? null : fail('an http or https address'); } catch { return fail('an address'); }
  })],
  'misc:cacheSize': [], 'misc:clearCache': [], 'misc:runTool': [str(260, 1)],
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
