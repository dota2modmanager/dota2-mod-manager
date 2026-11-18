/* The author's window (issue #236), opened from the account menu: the drafts from the main process
 * (src/creator.ts), each saved as it is typed into, one written out as an archive for the catalog's
 * maintainer, and one sent to the catalog's upload API. The form is catalog/../creator/CreatorModal.tsx. */
import { state } from '../core/store.ts';
import { RAIL_SECTIONS } from '../core/constants.ts';
import { catName } from '../core/categories.ts';
import { catalogConstants, catalogData } from '../catalog/data.ts';
import { toast } from '../ui/toast.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { fmtMB } from '../ui/format.ts';
import { showCreatorModal } from '../catalog/modal/root.tsx';
import type { CreatorModel } from '../creator/CreatorModal.tsx';
import type { CreatorDraft } from '../api/creator.ts';
import type { CategoryData } from '../catalog/types.ts';
import { ensureHero, HERO_CATEGORIES, nameFor, swapHero } from '../creator/naming.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './catalog/overlay.ts';

// a mod for the catalog is a mod: not a tool, a guide or a link, and not the categories the upload API refuses
const NOT_MODS = new Set(['tools', 'guides', 'sites', 'packs', 'creeps', 'fonts', 'news']);
const HERO_CATS = HERO_CATEGORIES;
const VIDEO_CATS = ['sounds', 'hero-sounds', 'huds', 'ti-bp-effects'];
const SLOT_EXCLUDE = new Set(['effects', 'icons', 'sounds']);

interface Options {
  heroes: string[];
  subcats: Record<string, { value: string; label: string }[]>;
  tags: Record<string, Record<string, string>>;
  slotTags: Record<string, string[]>;
  videoCats: string[];
  /** the catalog's authors and sources, by name, for the credits pickers */
  authors: string[];
  sources: string[];
}
type Rest = Omit<CreatorModel, 'categories' | 'heroCats' | keyof Options>;

function options(categories: string[]): Options {
  const c = catalogConstants() as Record<string, unknown>;
  const groups = (catalogData()?.mods?.modsData || {}) as Record<string, CategoryData | undefined>;
  const tags: Record<string, Record<string, string>> = {};
  const slotTags: Record<string, string[]> = {};
  const known = (c.TAG_CONFIGS || {}) as Record<string, { map?: Record<string, string> } | undefined>;
  for (const id of categories) {
    const map = known[id]?.map;
    if (!map) continue;
    tags[id] = map;
    slotTags[id] = ((c.slotTags as Record<string, string[]> | undefined)?.[id] || Object.keys(map).filter((k) => !SLOT_EXCLUDE.has(k)));
  }
  const subcats: Record<string, { value: string; label: string }[]> = {};
  for (const id of categories) {
    const data = groups[id];
    if (!data || Array.isArray(data) || !Array.isArray(data.groups)) continue;
    subcats[id] = data.groups.filter((g) => g && g.id).map((g) => ({ value: String(g.id), label: String(g.name || g.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  return {
    heroes: Array.isArray(c.HEROES_LIST) ? c.HEROES_LIST.map(String) : [],
    subcats,
    tags,
    slotTags,
    videoCats: VIDEO_CATS.filter((id) => categories.includes(id)),
    authors: Object.keys((c.MOD_AUTHOR || {}) as Record<string, string>).sort((a, b) => a.localeCompare(b)),
    sources: Object.keys((c.MOD_SOURCES || {}) as Record<string, string>).sort((a, b) => a.localeCompare(b)),
  };
}

let open = false;
let m: Rest = {
  drafts: [], open: null, busy: false, consent: { accepted: false, version: '', at: null }, uploader: false,
  historyOpen: false, historyItems: [], historyLoading: false, historyError: '',
};
sharesOverlay(() => { open = false; });

function draw(): void {
  if (!open) return;
  const categories = RAIL_SECTIONS.flatMap(([, ids]) => ids).filter((id) => !NOT_MODS.has(id)).map((id) => ({ value: id, label: catName(id) }));
  showCreatorModal({ ...m, categories, heroCats: HERO_CATS, ...options(categories.map((x) => x.value)) }, {
    close: closeOverlay,
    create: () => void create(),
    open: (id) => { m = { ...m, open: id }; draw(); },
    change: (id, fields) => void change(id, fields),
    attach: (id, style, kind) => void attach(id, style, kind),
    remove: (id) => void remove(id),
    export: (id) => void exportDraft(id),
    upload: (id) => void uploadDraft(id),
    acceptTerms: () => void acceptTerms(),
    showHistory: () => void loadHistory(true),
    hideHistory: () => { m = { ...m, historyOpen: false }; draw(); },
    history: () => void loadHistory(false),
  });
}

/** Ask the catalog what became of the submissions; the panel shows loading, then the answer. */
async function loadHistory(show: boolean): Promise<void> {
  m = { ...m, ...(show ? { historyOpen: true } : {}), historyLoading: true, historyError: '' };
  draw();
  const r = await window.api.creator.history();
  m = { ...m, historyLoading: false, historyItems: r.error ? [] : r.items || [], historyError: r.error || '' };
  draw();
}

const put = (d: CreatorDraft) => { m = { ...m, drafts: [d, ...m.drafts.filter((x) => x.id !== d.id)] }; };

/** The window, on the list of drafts. */
export async function openCreator(from: Element | null): Promise<void> {
  const r = await window.api.creator.list();
  if (r.error) { toast(r.error, 'error'); return; }
  takeOverlay();
  open = true;
  m = {
    drafts: r.drafts, open: null, busy: false, consent: r.consent, uploader: r.uploader,
    historyOpen: false, historyItems: [], historyLoading: false, historyError: '',
  };
  openOverlay(draw, from);
}

/** The terms are formal: the app records the agreement through its own API, as the site's dialog does. */
async function acceptTerms(): Promise<void> {
  m = { ...m, busy: true };
  draw();
  const r = await window.api.creator.accept();
  m = { ...m, busy: false, ...(r.consent ? { consent: r.consent } : {}) };
  if (r.error) toast(r.error, 'error');
  draw();
}

async function create(): Promise<void> {
  // the author is who signed in, until they pick a listed one or write another name
  const name = state.settings?.account?.username || '';
  const r = await window.api.creator.save(null, name ? { author: name, authorMode: 'new' } : { authorMode: 'skip' });
  if (r.error) { toast(r.error, 'error'); return; }
  put(r.draft);
  m = { ...m, open: r.draft.id };
  draw();
}

async function change(id: string, fields: Parameters<typeof window.api.creator.save>[1]): Promise<void> {
  const d = m.drafts.find((x) => x.id === id);
  const category = fields.category ?? d?.category ?? '';
  const hero = fields.hero ?? d?.hero ?? '';
  // the name is held to the catalog's rules the moment it is saved: title case, Latin only,
  // the room the hero allows, and the hero's own name in a hero's mod
  if (fields.name !== undefined) fields = { ...fields, name: nameFor(fields.name, hero, HERO_CATS.includes(category)) };
  // a new hero replaces the one the name already carries, or joins it at the front
  if (fields.hero && d && HERO_CATS.includes(category)) {
    const heroes = (catalogConstants().HEROES_LIST as string[] | undefined) || [];
    const swapped = d.name ? swapHero(d.name, fields.hero, heroes) : null;
    if (swapped !== null) fields = { ...fields, name: nameFor(swapped, fields.hero, true) };
    else if (fields.name === undefined) fields = { ...fields, name: ensureHero(d.name, fields.hero) };
  }
  const r = await window.api.creator.save(id, fields);
  if (r.error) { toast(r.error, 'error'); return; }
  put(r.draft);
  draw();
}

async function attach(id: string, style: number, kind: 'vpk' | 'picture'): Promise<void> {
  m = { ...m, busy: true };
  draw();
  const r = await window.api.creator.attach(id, style, kind);
  m = { ...m, busy: false };
  if (r.error) toast(r.error, 'error', 7000);
  else if (r.draft) put(r.draft);
  draw();
}

async function remove(id: string): Promise<void> {
  const d = m.drafts.find((x) => x.id === id);
  if (!await confirmDialog(L`Удалить черновик «${d?.name || L`Без названия`}»?`)) return;
  const r = await window.api.creator.remove(id);
  if (r.error) { toast(r.error, 'error'); return; }
  m = { ...m, drafts: m.drafts.filter((x) => x.id !== id), open: null };
  draw();
}

/** A picture as the catalog's preview: 854x480, cropped to fill, in WebP, as PreMod makes it. */
async function webpOf(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 854;
    canvas.height = 480;
    const scale = Math.max(854 / img.naturalWidth, 480 / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    canvas.getContext('2d')!.drawImage(img, (854 - w) / 2, (480 - h) / 2, w, h);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 0.9));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch { return null; }
}

async function exportDraft(id: string): Promise<void> {
  m = { ...m, busy: true };
  draw();
  const d = m.drafts.find((x) => x.id === id);
  const previews = await Promise.all((d?.pictures || []).map(webpOf));
  const r = await window.api.creator.export(id, previews);
  m = { ...m, busy: false };
  draw();
  if (r.error) toast(r.error, 'error', 8000);
  else if (!r.cancelled) toast(L`Архив сохранён · ${fmtMB(r.size || 0)} МБ`);
}

async function uploadDraft(id: string): Promise<void> {
  m = { ...m, busy: true };
  draw();
  const d = m.drafts.find((x) => x.id === id);
  const previews = await Promise.all((d?.pictures || []).map(webpOf));
  const r = await window.api.creator.upload(id, previews);
  if (r.error) {
    m = { ...m, busy: false };
    draw();
    toast(r.error, 'error', 10000);
    return;
  }
  // The catalog has it now, so the local copy has done its job: delete the draft itself, not
  // just its row, or it comes back the next time the window opens. A failed delete leaves the
  // draft in the list, since it is still on disk.
  const gone = await window.api.creator.remove(id);
  m = {
    ...m,
    busy: false,
    ...(gone.error ? {} : { drafts: m.drafts.filter((x) => x.id !== id), open: m.open === id ? null : m.open }),
  };
  draw();
  toast(L`Мод отправлен на модерацию`);
  if (r.url) void window.api.misc.openExternal(r.url);
  if (gone.error) toast(L`Мод отправлен, но черновик не удалился: ${gone.error}`, 'error', 10000);
}
