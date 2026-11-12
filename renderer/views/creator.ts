/* The author's window (issue #236, step 1), opened from the account menu: the drafts from the main
 * process (src/creator.ts), each saved as it is typed into, and one written out as an archive for
 * the catalog's maintainer. The form is catalog/../creator/CreatorModal.tsx. */
import { state } from '../core/store.ts';
import { RAIL_SECTIONS } from '../core/constants.ts';
import { catName } from '../core/categories.ts';
import { toast } from '../ui/toast.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { fmtMB } from '../ui/format.ts';
import { showCreatorModal } from '../catalog/modal/root.tsx';
import type { CreatorModel } from '../creator/CreatorModal.tsx';
import type { CreatorDraft } from '../api/creator.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './catalog/overlay.ts';

// a mod for the catalog is a mod: not a tool, a guide or a link
const NOT_MODS = new Set(['tools', 'guides', 'sites', 'packs']);
const HERO_CATS = ['heroes', 'hero-items', 'herofx', 'hero-sounds'];

let open = false;
let m: Omit<CreatorModel, 'categories' | 'heroCats'> = { drafts: [], open: null, busy: false };
sharesOverlay(() => { open = false; });

function draw(): void {
  if (!open) return;
  const categories = RAIL_SECTIONS.flatMap(([, ids]) => ids).filter((id) => !NOT_MODS.has(id)).map((id) => ({ value: id, label: catName(id) }));
  showCreatorModal({ ...m, categories, heroCats: HERO_CATS }, {
    close: closeOverlay,
    create: () => void create(),
    open: (id) => { m = { ...m, open: id }; draw(); },
    change: (id, fields) => void change(id, fields),
    attach: (id, style, kind) => void attach(id, style, kind),
    remove: (id) => void remove(id),
    export: (id) => void exportDraft(id),
  });
}

const put = (d: CreatorDraft) => { m = { ...m, drafts: [d, ...m.drafts.filter((x) => x.id !== d.id)] }; };

/** The window, on the list of drafts. */
export async function openCreator(from: Element | null): Promise<void> {
  const r = await window.api.creator.list();
  if (r.error) { toast(r.error, 'error'); return; }
  takeOverlay();
  open = true;
  m = { drafts: r.drafts, open: null, busy: false };
  openOverlay(draw, from);
}

async function create(): Promise<void> {
  // the author is who signed in, until they write another name
  const r = await window.api.creator.save(null, { author: state.settings?.account?.username || '' });
  if (r.error) { toast(r.error, 'error'); return; }
  put(r.draft);
  m = { ...m, open: r.draft.id };
  draw();
}

async function change(id: string, fields: Parameters<typeof window.api.creator.save>[1]): Promise<void> {
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
