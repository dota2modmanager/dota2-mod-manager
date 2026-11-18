/* Hero picker portraits of the user's own: the window, opened from the Workshop. Every hero and his
 * game portrait come first; pointing at one fetches his game movie once; a hero clicked comes up
 * close with his own picture and movie. The picture is cut to the game's sizes and the movie
 * encoded here (catalog/portraits/cut.ts); the pak is made by the core, one mod per hero. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { toast } from '../../ui/toast.ts';
import { showPortraitStudio } from '../../catalog/modal/root.tsx';
import { blobUrl, cutAll, cutMovie } from '../../catalog/portraits/cut.ts';
import type { PortraitDetail, PortraitHero, PortraitStudioModel } from '../../catalog/portraits/model.ts';
import type { PortraitTarget } from '../../api/portraits.ts';
import { sourceKind } from '../../catalog/background/encode.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';

let open = false;
let m: PortraitStudioModel = { heroes: [], filter: '', open: null, view: 'mine', busy: null };
/** what was picked for the hero up close and not put on yet */
let picked: { still: File | null; stillUrl: string | null; movie: File | null; movieUrl: string | null; drop: Set<'still' | 'movie'>; source: string | null } = blank();
/** the urls this window made, given back when it closes */
const made = new Set<string>();
const movies = new Map<string, Promise<string | null>>();
let installedNow = 0;
sharesOverlay(() => { open = false; });

function blank() { return { still: null, stillUrl: null, movie: null, movieUrl: null, drop: new Set<'still' | 'movie'>(), source: null }; }

/** How many heroes have a portrait of the user's own on, for the Workshop's tile. */
export const portraitsOn = (): number => installedNow;

/** Read once at start, so the tile can say what is on. */
export async function readPortraits(): Promise<void> {
  const r = await window.api.portraits.state().catch(() => null);
  if (r && !r.error && 'own' in r) installedNow = Object.keys(r.own).length;
}

const url = (b: Blob) => { const u = URL.createObjectURL(b); made.add(u); return u; };
const draw = () => { if (open) showPortraitStudio(m, actions); };

/** The window. */
export async function openPortraits(from: Element | null): Promise<void> {
  const r = await window.api.portraits.state();
  if (r.error || !('heroes' in r)) { toast(r.error || L`Не удалось прочитать героев игры`, 'error'); return; }
  takeOverlay();
  open = true;
  installedNow = Object.keys(r.own).length;
  const heroes: PortraitHero[] = r.heroes.map((h) => ({ hero: h.hero, name: h.name, picture: null, movie: null, own: r.own[h.hero] ?? null }));
  heroes.sort((a, b) => a.name.localeCompare(b.name));
  m = { heroes, filter: '', open: null, view: 'mine', busy: null };
  openOverlay(draw, from);
  const pics = await window.api.cosmetics.heroPortraits(heroes.map((h) => h.hero), true).catch(() => ({} as Record<string, string>));
  m = { ...m, heroes: m.heroes.map((h) => ({ ...h, picture: pics[h.hero] ?? null })) };
  draw();
}

/** The hero's game movie, asked for once. */
function gameMovie(hero: string): Promise<string | null> {
  let p = movies.get(hero);
  if (!p) {
    p = window.api.portraits.hero(hero).then(async (r) => (!r.error && 'gameMovie' in r && r.gameMovie ? blobUrl(r.gameMovie).then((u) => { made.add(u); return u; }) : null)).catch(() => null);
    movies.set(hero, p);
  }
  return p;
}

async function hover(hero: string): Promise<void> {
  if (m.heroes.find((h) => h.hero === hero)?.movie) return;
  const u = await gameMovie(hero);
  if (!u || !open) return;
  m = { ...m, heroes: m.heroes.map((h) => (h.hero === hero ? { ...h, movie: u } : h)) };
  draw();
}

let targets: PortraitTarget[] = [];
let have: { still: string | null; movie: string | null } = { still: null, movie: null };

function detail(hero: string): PortraitDetail {
  const h = m.heroes.find((x) => x.hero === hero)!;
  const still = picked.stillUrl ?? (picked.drop.has('still') ? null : have.still);
  const movie = picked.movieUrl ?? (picked.drop.has('movie') ? null : have.movie);
  return {
    hero, name: h.name, targets, gamePicture: h.picture, gameMovie: h.movie,
    ownPicture: still, ownMovie: movie,
    fresh: { still: !!picked.still, movie: !!picked.movie },
    dirty: !!(picked.still || picked.movie || picked.drop.size), installed: !!h.own,
  };
}

/** The hero up close. Clicked in the grid, he comes up at once with what the grid already has, and
 * his own picture and movie fill in when the core answers; after a build he is only read again. */
async function pick(hero: string, clicked = true): Promise<void> {
  if (clicked) {
    picked = blank();
    targets = [];
    have = { still: null, movie: null };
    m = { ...m, view: 'mine', open: detail(hero) };
    draw();
  }
  void hover(hero);
  const r = await window.api.portraits.hero(hero);
  if (r.error || !('targets' in r)) { toast(r.error || L`Не удалось прочитать героя`, 'error'); return; }
  const movie = r.ownMovie ? await blobUrl(r.ownMovie).then((u) => { made.add(u); return u; }) : null;
  if (m.open?.hero !== hero) return;
  targets = r.targets;
  have = { still: r.ownStill, movie };
  if (!clicked) picked = blank();
  m = { ...m, open: detail(hero) };
  draw();
}

async function pickStill(f: File): Promise<void> {
  if (!m.open || !/^image\//.test(f.type)) { toast(L`Нужна картинка`, 'error'); return; }
  picked = { ...picked, still: f, stillUrl: url(f), source: f.name, drop: new Set([...picked.drop].filter((d) => d !== 'still')) };
  m = { ...m, open: detail(m.open.hero), view: 'mine' };
  draw();
}

async function pickMovie(f: File): Promise<void> {
  if (!m.open || !sourceKind(f.type)) { toast(L`Нужна картинка, GIF или видео`, 'error'); return; }
  const hero = m.open.hero;
  m = { ...m, busy: 0 };
  draw();
  try {
    const webm = await cutMovie(f, (p) => { m = { ...m, busy: Math.min(p, 0.99) }; draw(); });
    if (m.open?.hero !== hero) { m = { ...m, busy: null }; draw(); return; }
    movieBytes = webm;
    const movieUrl = url(new Blob([webm as BlobPart], { type: 'video/webm' }));
    picked = { ...picked, movie: f, movieUrl, source: picked.source ?? f.name, drop: new Set([...picked.drop].filter((d) => d !== 'movie')) };
    m = { ...m, busy: null, view: 'mine', open: detail(hero) };
  } catch (err) {
    m = { ...m, busy: null };
    toast(String((err as Error)?.message || err), 'error', 8000);
  }
  draw();
}
let movieBytes: Uint8Array | null = null;

function drop(part: 'still' | 'movie'): void {
  if (!m.open) return;
  if (part === 'still') picked = { ...picked, still: null, stillUrl: null };
  else { picked = { ...picked, movie: null, movieUrl: null }; movieBytes = null; }
  picked.drop.add(part);
  m = { ...m, open: detail(m.open.hero) };
  draw();
}

async function install(): Promise<void> {
  const d = m.open;
  if (!d || m.busy !== null || !targets.length) return;
  m = { ...m, busy: 1 };
  draw();
  try {
    const stills = picked.still ? await cutAll(picked.still, targets) : [];
    const r = await window.api.portraits.set(d.hero, stills, picked.movie ? movieBytes : null, [...picked.drop], picked.source);
    if (r.error) throw new Error(r.error);
    const on = !!r.record;
    toast(on ? L`Собрано и стоит в «Моих модах»` : L`Портрет как в игре`);
    m = { ...m, busy: null, heroes: m.heroes.map((h) => (h.hero === d.hero ? { ...h, own: on ? { still: true, movie: true } : null } : h)) };
    installedNow = m.heroes.filter((h) => h.own).length;
    await refreshInstalledIndex();
    void import('../studio.ts').then((st) => st.refreshStudio());
    await pick(d.hero, false);
  } catch (err) {
    m = { ...m, busy: null };
    toast(String((err as Error)?.message || err), 'error', 8000);
    draw();
  }
}

function close(): void {
  for (const u of made) URL.revokeObjectURL(u);
  made.clear();
  movies.clear();
  closeOverlay();
}

const actions = {
  close,
  filter: (text: string) => { m = { ...m, filter: text }; draw(); },
  pick: (hero: string) => void pick(hero),
  hover: (hero: string) => void hover(hero),
  back: () => { m = { ...m, open: null }; picked = blank(); movieBytes = null; draw(); },
  view: (v: 'game' | 'mine') => { m = { ...m, view: v }; draw(); },
  still: (f: File) => void pickStill(f),
  movie: (f: File) => void pickMovie(f),
  drop,
  install: () => void install(),
};
