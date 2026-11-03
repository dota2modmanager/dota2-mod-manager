/* Hero grids for the pick screen out of this patch's numbers (issue #428).
 *
 * The game keeps the grids in Steam's folder for the account, not in the game:
 * userdata/<account>/570/remote/cfg/hero_grid_config.json. That makes them safe in any mode: no
 * pak, no search path, nothing Valve checks. The numbers are OpenDota's public heroStats: picks
 * and wins per rank bracket, for the matches of the last days.
 *
 * The file holds the user's own grids too, so the app never replaces it. It adds its grids as
 * configs whose name starts with GRID_PREFIX, puts them back on the next apply, and takes only
 * those away on "remove". The file as it was before the first write is kept in userData anyway.
 */
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';
import { writeFileAtomic } from './atomic-file.ts';
import { downloadProxyFetchInit } from './download-proxy.ts';

/** Where the numbers come from. */
export const HERO_STATS_API = 'https://api.opendota.com/api/heroStats';
/** How the app's grids are told apart from the user's in the same file. */
export const GRID_PREFIX = 'D2MM · ';
/** The grids the app can make. */
export const GRID_KINDS = ['winrate', 'attribute', 'popular'] as const;
/** One of the grids the app can make. */
export type GridKind = typeof GRID_KINDS[number];

/** One hero as heroStats lists it, cut to what a grid needs. */
export interface HeroStat {
  id: number;
  localized_name?: string;
  primary_attr?: string;
  pub_pick?: number;
  pub_win?: number;
  [bracket: string]: unknown;
}

interface Category { category_name: string; x_position: number; y_position: number; width: number; height: number; hero_ids: number[] }
interface Config { config_name: string; categories: Category[] }
interface GridFile { version: number; configs: Config[]; [key: string]: unknown }

/* Picks and wins across every bracket. Older answers had pub_pick/pub_win; the current one has
 * them per bracket only ("1_pick" .. "8_pick"), so the sum is the same number either way. */
function totals(h: HeroStat): { picks: number; wins: number } {
  if (typeof h.pub_pick === 'number' && typeof h.pub_win === 'number' && h.pub_pick > 0) return { picks: h.pub_pick, wins: h.pub_win };
  let picks = 0;
  let wins = 0;
  for (let b = 1; b <= 8; b++) {
    picks += Number(h[`${b}_pick`]) || 0;
    wins += Number(h[`${b}_win`]) || 0;
  }
  return { picks, wins };
}

/** Win rate as a fraction, 0 for a hero nobody picked. */
const winRate = (h: HeroStat) => { const { picks, wins } = totals(h); return picks ? wins / picks : 0; };

/* The canvas the pick screen gives a grid is about 1200 by 600, and the game shrinks portraits to
 * fit the box a category is given (the grids it writes itself show 52 px portraits in one box and
 * 38 px in the next). Each category is one band across the full width; the height is shared out by
 * how many rows each band needs at full size, so the bands fill the canvas and none spills off it. */
const WIDTH = 1180;
const HEIGHT = 560;
const CELL_W = 52;
const GAP = 16;

function layout(bands: Array<{ name: string; ids: number[] }>): Category[] {
  const used = bands.filter((b) => b.ids.length);
  const perRow = Math.floor(WIDTH / CELL_W);
  const rows = used.map((b) => Math.ceil(b.ids.length / perRow));
  const unit = (HEIGHT - GAP * (used.length - 1)) / rows.reduce((a, b) => a + b, 0);
  let y = 0;
  return used.map((b, i) => {
    const height = Math.round(rows[i] * unit);
    const cat = { category_name: b.name, x_position: 0, y_position: y, width: WIDTH, height, hero_ids: b.ids };
    y += height + GAP;
    return cat;
  });
}

const byWinRate = (a: HeroStat, b: HeroStat) => winRate(b) - winRate(a);

/** The name a grid of this kind carries in the pick screen, in the app's language. */
export function gridName(kind: GridKind): string {
  const name = kind === 'winrate' ? t('Процент побед') : kind === 'attribute' ? t('По атрибутам') : t('Чаще всего берут');
  return `${GRID_PREFIX}${name}`;
}

/** The grid of one kind out of heroStats: its name in the file and its categories. */
export function buildGrid(stats: HeroStat[], kind: GridKind): Config {
  const heroes = stats.filter((h) => Number.isInteger(h.id) && h.id > 0 && totals(h).picks > 0);
  if (kind === 'winrate') {
    const tiers = [[0.53, 1.01], [0.51, 0.53], [0.49, 0.51], [0.47, 0.49], [0, 0.47]] as const;
    const names = [t('Выше {0}', '53%'), '51–53%', '49–51%', '47–49%', t('Ниже {0}', '47%')];
    return {
      config_name: gridName('winrate'),
      categories: layout(tiers.map(([lo, hi], i) => ({
        name: names[i],
        ids: heroes.filter((h) => winRate(h) >= lo && winRate(h) < hi).sort(byWinRate).map((h) => h.id),
      }))),
    };
  }
  if (kind === 'attribute') {
    const attrs: Array<[string, string]> = [['str', t('Сила')], ['agi', t('Ловкость')], ['int', t('Интеллект')], ['all', t('Универсальные')]];
    return {
      config_name: gridName('attribute'),
      categories: layout(attrs.map(([a, name]) => ({ name, ids: heroes.filter((h) => h.primary_attr === a).sort(byWinRate).map((h) => h.id) }))),
    };
  }
  const popular = [...heroes].sort((a, b) => totals(b).picks - totals(a).picks);
  return {
    config_name: gridName('popular'),
    categories: layout([
      { name: t('Топ {0}', 20), ids: popular.slice(0, 20).map((h) => h.id) },
      { name: t('Следом'), ids: popular.slice(20, 60).map((h) => h.id) },
      { name: t('Реже всех'), ids: popular.slice(60).map((h) => h.id) },
    ]),
  };
}

/** The file with the app's grids swapped for these; the user's configs and anything else stay. */
export function mergeGrids(existing: string | null, ours: Config[]): string {
  let file: GridFile = { version: 3, configs: [] };
  if (existing) {
    const parsed = JSON.parse(existing) as GridFile;
    if (!parsed || !Array.isArray(parsed.configs)) throw new Error(t('Файл сеток героев не похож на файл игры'));
    file = parsed;
  }
  const theirs = file.configs.filter((c) => !String(c.config_name || '').startsWith(GRID_PREFIX));
  return `${JSON.stringify({ ...file, configs: [...theirs, ...ours] }, null, '\t')}\n`;
}

/** The grid file of the account, under a Steam account folder (userdata/<id>). */
export const gridFile = (accountDir: string) => path.join(accountDir, '570', 'remote', 'cfg', 'hero_grid_config.json');

/** Which of the app's grids are in a grid file now, by config name. */
export function gridsIn(text: string | null): string[] {
  if (!text) return [];
  try {
    const file = JSON.parse(text) as GridFile;
    return (file.configs || []).map((c) => String(c.config_name || '')).filter((n) => n.startsWith(GRID_PREFIX));
  } catch {
    return [];
  }
}

const readOrNull = (file: string) => { try { return fs.readFileSync(file, 'utf-8'); } catch { return null; } };

/**
 * The grids for one account: the numbers fetched (and cached in userData, so a down API still
 * leaves the last ones), the file written with a backup of how it was first.
 */
export function createHeroGrids({ dataDir, accountDir, fetch = globalThis.fetch, now = Date.now }: {
  /** where the cache and the backup live (userData/hero-grid) */
  dataDir: string;
  /** the logged-in account's userdata folder, or null when Steam has none */
  accountDir: () => string | null;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}) {
  const cacheFile = path.join(dataDir, 'hero-stats.json');

  /** The cached numbers and when they came, if any came. */
  function cached(): { at: number; stats: HeroStat[] } | null {
    const text = readOrNull(cacheFile);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  async function freshStats(): Promise<{ at: number; stats: HeroStat[] }> {
    try {
      const res = await fetch(HERO_STATS_API, { signal: AbortSignal.timeout(15000), ...downloadProxyFetchInit() } as RequestInit);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stats = await res.json() as HeroStat[];
      if (!Array.isArray(stats) || stats.length < 100) throw new Error(t('OpenDota прислал не список героев'));
      const got = { at: now(), stats };
      fs.mkdirSync(dataDir, { recursive: true });
      writeFileAtomic(cacheFile, JSON.stringify(got));
      return got;
    } catch (err) {
      const old = cached();
      if (old) return old;
      throw new Error(t('Не удалось получить статистику OpenDota: {0}', err instanceof Error ? err.message : String(err)));
    }
  }

  /** What the settings row shows: whose file, which of our grids it has, how old the numbers are. */
  function state(): { account: boolean; kinds: GridKind[]; statsAt: number | null } {
    const dir = accountDir();
    const names = dir ? gridsIn(readOrNull(gridFile(dir))) : [];
    return { account: Boolean(dir), kinds: GRID_KINDS.filter((k) => names.includes(gridName(k))), statsAt: cached()?.at ?? null };
  }

  /** Write the grids of these kinds into the account's file, in place of the app's old ones. */
  async function apply(kinds: GridKind[]): Promise<{ kinds: GridKind[]; statsAt: number }> {
    const dir = accountDir();
    if (!dir) throw new Error(t('Не нашёл аккаунт Steam, в который заходила Dota 2'));
    const { at, stats } = await freshStats();
    const file = gridFile(dir);
    const before = readOrNull(file);
    const backup = path.join(dataDir, `hero_grid_config.${path.basename(dir)}.backup.json`);
    fs.mkdirSync(dataDir, { recursive: true });
    if (before !== null && !fs.existsSync(backup)) fs.writeFileSync(backup, before);
    const wanted = GRID_KINDS.filter((k) => kinds.includes(k));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, mergeGrids(before, wanted.map((k) => buildGrid(stats, k))));
    return { kinds: wanted, statsAt: at };
  }

  /** Take the app's grids out and leave the user's. */
  function remove(): { kinds: GridKind[] } {
    const dir = accountDir();
    if (!dir) return { kinds: [] };
    const file = gridFile(dir);
    const before = readOrNull(file);
    if (before !== null && gridsIn(before).length) writeFileAtomic(file, mergeGrids(before, []));
    return { kinds: [] };
  }

  return { state, apply, remove };
}
