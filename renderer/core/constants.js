/* Values the whole renderer agrees on: where catalog assets come from, what each
 * category is called and drawn with, which cosmetic slots we know a label for, and the
 * defaults behind the toolbar and the resizable chrome panels.
 *
 * These are data, not behaviour. Anything that needs a decision made about them lives
 * with the view that makes it. */

export const RAW_BASE = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main';

/* The same files, from a host that is not GitHub.
 *
 * Pictures are the one thing the renderer fetches itself, so they never went through the
 * mirror chain in src/net.ts that everything else uses. For anybody who cannot reach GitHub
 * that meant a catalog that loaded and a grid of empty squares: the app looked broken while
 * working. tools/r2-sync.mjs copies every preview here, and ui/media.js reaches for it when a
 * picture fails to arrive.
 */
export const MIRROR_BASE = 'https://cdn.dota2modmanager.com';

export const CAT_RU = {
  heroes: 'Герои', 'item-effects': 'Эффекты предметов', 'hero-items': 'Предметы героев',
  backgrounds: 'Фоны меню', cursors: 'Курсоры', 'mega-kill': 'Мега-килл', shaders: 'Шейдеры',
  couriers: 'Курьеры', terrains: 'Ландшафты', creeps: 'Крипы', trees: 'Деревья', river: 'Река',
  'ti-bp-effects': 'Паки эффектов', emblems: 'Эмблемы', 'creep-deny': 'Денай крипов',
  music: 'Музыка', 'hero-sounds': 'Звуки героев', sounds: 'Звуки', 'ranged-attack': 'Дальние атаки',
  other: 'Разное', ranks: 'Ранги', 'item-icons': 'Иконки предметов', 'versus-screens': 'Экраны Versus',
  announcers: 'Анонсеры', wards: 'Варды', pedestal: 'Пьедесталы', huds: 'HUD',
  herofx: 'Эффекты героев', pings: 'Пинги', packs: 'Паки', optimization: 'Оптимизация',
  tormentor: 'Торментор', 'high-five': 'High Five', ancient: 'Древние', roshan: 'Рошан',
  towers: 'Башни', fonts: 'Шрифты', sites: 'Сайты', guides: 'Гайды', news: 'Новости',
  tools: 'Инструменты', imported: 'Импортированный',
};

export const CAT_ICON = {
  all: 'apps', heroes: 'person', 'hero-items': 'swords', herofx: 'auto_fix_high',
  'hero-sounds': 'record_voice_over', terrains: 'landscape', trees: 'forest', river: 'water',
  creeps: 'bug_report', towers: 'cell_tower', roshan: 'skull', ancient: 'castle',
  tormentor: 'deployed_code', wards: 'visibility', couriers: 'pets', pedestal: 'podium',
  'creep-deny': 'block', shaders: 'palette', 'ti-bp-effects': 'auto_awesome',
  'item-effects': 'bolt', 'ranged-attack': 'my_location', 'high-five': 'waving_hand',
  backgrounds: 'wallpaper', huds: 'dashboard', emblems: 'military_tech',
  'versus-screens': 'compare_arrows', 'item-icons': 'category', ranks: 'workspace_premium',
  pings: 'notifications_active', cursors: 'arrow_selector_tool', fonts: 'text_fields',
  announcers: 'mic', 'mega-kill': 'campaign', music: 'music_note', sounds: 'volume_up',
  packs: 'inventory_2', optimization: 'speed', other: 'widgets', guides: 'menu_book',
  sites: 'language', tools: 'build', news: 'newspaper',
};

// Free cosmetics: each is a slot in the game's own item schema (see src/schema.js), read
// live from the installed game — so a slot Valve adds later just shows up. This only maps
// the ones we know a nice label/icon for; an unknown one still works, titled from its id.
export const COSMETIC_SLOTS = {
  weather: { label: 'Погода', icon: 'rainy' },
  items: { label: 'Предметы', icon: 'checkroom' },
  terrain: { label: 'Ландшафт', icon: 'terrain' },
  hud_skin: { label: 'Интерфейс игры', icon: 'dashboard' },
  loading_screen: { label: 'Экран загрузки', icon: 'image' },
  versus_screen: { label: 'Экран противостояния', icon: 'compare_arrows' },
  courier: { label: 'Курьер', icon: 'pets' },
  ward: { label: 'Варды', icon: 'visibility' },
  radiantcreeps: { label: 'Крипы Света', icon: 'groups' },
  direcreeps: { label: 'Крипы Тьмы', icon: 'groups' },
  radiantsiegecreeps: { label: 'Осадные Света', icon: 'shield' },
  diresiegecreeps: { label: 'Осадные Тьмы', icon: 'shield' },
  radianttowers: { label: 'Башни Света', icon: 'castle' },
  diretowers: { label: 'Башни Тьмы', icon: 'castle' },
  music: { label: 'Музыка', icon: 'music_note' },
  announcer: { label: 'Комментатор', icon: 'campaign' },
  mega_kills: { label: 'Мега-килл', icon: 'record_voice_over' },
  streak_effect: { label: 'Серия убийств', icon: 'local_fire_department' },
};
export const COSMETIC_PREFIX = 'cosmetic:';
export function cosmeticMeta(slot) {
  if (COSMETIC_SLOTS[slot]) return COSMETIC_SLOTS[slot];
  if (String(slot).startsWith('item:')) {
    const equip = String(slot).split(':').pop();
    const icon = {
      head: 'face', hair: 'content_cut', weapon: 'swords', offhand: 'shield', shield: 'shield', armor: 'security',
      shoulder: 'accessibility_new', shoulders: 'accessibility_new', belt: 'checkroom', arms: 'front_hand',
      arm: 'front_hand', back: 'checkroom', wings: 'flutter_dash', tail: 'gesture', legs: 'directions_run',
      mount: 'pets', ambient: 'auto_awesome', misc: 'checkroom',
    }[equip] || 'checkroom';
    return { label: 'Предметы', icon };
  }
  return { label: slot.replace(/_/g, ' '), icon: 'auto_awesome' };
}

// rail sections: [label, [categoryIds]]
export const RAIL_SECTIONS = [
  ['Герои', ['heroes', 'hero-items', 'herofx', 'hero-sounds']],
  ['Мир', ['terrains', 'trees', 'river', 'creeps', 'towers', 'roshan', 'ancient', 'tormentor', 'wards', 'couriers', 'pedestal', 'creep-deny']],
  ['Эффекты', ['shaders', 'ti-bp-effects', 'item-effects', 'ranged-attack', 'high-five']],
  ['Интерфейс', ['backgrounds', 'huds', 'emblems', 'versus-screens', 'item-icons', 'ranks', 'pings', 'cursors', 'fonts']],
  ['Звук', ['announcers', 'mega-kill', 'music', 'sounds']],
  ['Прочее', ['packs', 'optimization', 'other', 'tools', 'guides', 'sites']],
];

export const CATALOG_EXCLUDE = ['news'];

/* Tools we do not offer, for reasons of ours rather than the catalog's. The Linux build of
 * Background Changer cannot run next to a Windows Dota, and this app's own installer has no
 * business being downloaded by the running app - it updates itself. Matched by name because
 * that is all the catalog gives us to match on. */
export const TOOLS_HIDDEN = [/linux/i, /^dota 2 mod manager$/i];

/* A guide the catalog wrote and hung on nothing. "weather" explains the Patcher tool, whose
 * own guideId points at the safety warning instead, so with the guides screen gone it would
 * be unreachable. This hands an orphan to the mod that needs it, keyed by the guide the mod
 * already names. The other five orphans stay dropped: two are for Linux and three are
 * general how-tos the wiki covers. */
export const GUIDE_ALSO = { warning: ['weather'] };

/* Where a stuck user goes. Both are in the catalog's own "news" entries, which is what the
 * help menu reads - these are the fallback for a first run with no catalog yet. */
export const HELP_LINKS = {
  wiki: 'https://d2pfxwiki.pages.dev/',
  discord: 'https://discord.gg/PBvG8D9MxT',
};

export const SORTS = [
  { key: 'default', label: 'По умолчанию' },
  { key: 'date', label: 'Сначала новые' },
  { key: 'name', label: 'По имени А-Я' },
  { key: 'name-desc', label: 'По имени Я-А' },
];

// What the toolbar above a grid holds. Mods and free cosmetics share it, so "Установленные"
// and "Избранное" mean the same thing wherever they are — and switching category resets it.
export const FILTER_DEFAULTS = { sort: 'default', tags: new Set(), installedOnly: false, favOnly: false, group: '', hero: '', slot: '' };
export const freshFilters = () => ({ ...FILTER_DEFAULTS, tags: new Set() });

// Chrome panels the user can resize, scale and fold away: the title bar, the status bar and
// the category rail. Everything lives in CSS variables (see "Panel grips").
// Two independent knobs each: the grip drags its size, Ctrl + wheel over it sets its own
// zoom. Neither follows the content scale — scaling the catalog leaves the chrome alone.
export const PANEL_DEFAULTS = {
  topH: 48, bottomH: 50, railW: 218,
  topZoom: 1, bottomZoom: 1, railZoom: 1,
  topFolded: false, bottomFolded: false, railFolded: false,
};
export const PANEL_LIMITS = { topH: [34, 88], bottomH: [36, 96], railW: [148, 400] };
export const PANEL_ZOOM_LIMITS = [0.6, 1.8];
