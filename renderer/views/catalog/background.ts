/* A main menu background of the user's own (issue #418): the card first among the backgrounds and
 * its window. The file is turned into a WebM here (catalog/background/encode.ts) and handed over;
 * the pak is made in the main process (src/menu-background-service.ts) and is a mod in My mods like
 * any other, one at a time. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showBackgroundModal } from '../../catalog/modal/root.tsx';
import { encodeBackground, sourceKind } from '../../catalog/background/encode.ts';
import type { BackgroundCardModel } from '../../catalog/background/BackgroundCard.tsx';
import type { BackgroundModalModel } from '../../catalog/background/BackgroundModal.tsx';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

let open = false;
let m: BackgroundModalModel = { file: null, dim: 0.2, blur: 0, installed: null, busy: null };
let picked: File | null = null;
sharesOverlay(() => { open = false; });

type Generated = { background?: string; source?: string };
const mine = () => [...store.installedIndex.values()].find((r) => (r.generated as Generated | undefined)?.background) ?? null;

/** The card first among the backgrounds. */
export function backgroundLead(category: string): BackgroundCardModel | null {
  if (category !== 'backgrounds') return null;
  return { installed: (mine()?.generated as Generated | undefined)?.source ?? null };
}

const drop = () => { if (m.file?.url) URL.revokeObjectURL(m.file.url); };

/** The window, on the background on now when there is one. */
export async function openBackground(from: Element | null): Promise<void> {
  const r = await window.api.background.state();
  if (r.error || !('installed' in r)) { toast(r.error || L`Не удалось прочитать фон`, 'error'); return; }
  takeOverlay();
  open = true;
  drop();
  picked = null;
  const on = r.installed;
  m = on
    ? { file: { name: on.source, url: null, kind: 'still' }, dim: on.dim, blur: on.blur, installed: { source: on.source, enabled: on.enabled }, busy: null }
    : { file: null, dim: 0.2, blur: 0, installed: null, busy: null };
  openOverlay(draw, from);
}

function draw(): void {
  if (!open) return;
  showBackgroundModal(m, {
    close: () => { drop(); closeOverlay(); },
    file: (f) => pick(f),
    dim: (dim) => { m = { ...m, dim }; draw(); },
    blur: (blur) => { m = { ...m, blur }; draw(); },
    install: () => void install(),
  });
}

function pick(f: File): void {
  const kind = sourceKind(f.type);
  if (!kind) { toast(L`Нужна картинка, GIF или видео`, 'error'); return; }
  drop();
  picked = f;
  m = { ...m, file: { name: f.name, url: URL.createObjectURL(f), kind } };
  draw();
}

async function install(): Promise<void> {
  if (!m.file || m.busy !== null) return;
  m = { ...m, busy: picked ? 0 : 1 };
  draw();
  let webm: Uint8Array | null = null;
  if (picked) {
    try {
      webm = (await encodeBackground(picked, (p) => { m = { ...m, busy: Math.min(p, 0.99) }; draw(); })).webm;
    } catch (err) {
      m = { ...m, busy: null };
      toast(String((err as Error)?.message || err), 'error', 8000);
      draw();
      return;
    }
    m = { ...m, busy: 1 };
    draw();
  }
  const r = await window.api.background.install(webm, picked?.name ?? null, m.dim, m.blur).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  picked = null;
  m = { ...m, installed: { source: m.file?.name ?? '', enabled: true } };
  await refreshInstalledIndex();
  await screen.redraw();
  draw();
}

/** From My mods: the backgrounds, with the window open. */
export async function backgroundFromLibrary(): Promise<void> {
  store.activeCategory = 'backgrounds';
  await switchView('catalog');
  await screen.redraw();
  await openBackground(null);
}
