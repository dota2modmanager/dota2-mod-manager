/* A hero recoloured part by part (issue #422): the window opened from the hero's window in the item
 * builder. It keeps a switch and a colour per layer; nothing reaches the game until its button is
 * pressed, and then the main process builds one pak for the hero (src/hero-paint-service.ts), a mod
 * in My mods like any other. */
import { refreshInstalledIndex } from '../core/installed.ts';
import { toast } from '../ui/toast.ts';
import { showPaintModal } from '../catalog/modal/root.tsx';
import type { PaintCell, PaintModalModel } from '../catalog/paint/PaintModal.tsx';
import type { PaintLayer } from '../api/content.ts';
import { closeOverlay } from './catalog/overlay.ts';
import { isOpen, openWindow } from './item-builder.ts';

interface PaintState {
  hero: string;
  label: string;
  back: () => void;
  layers: PaintLayer[];
  on: Set<string>;
  colors: Map<string, string>;
  /** what is in the game now, to say whether the button changes anything */
  installed: Record<string, string> | null;
  all: string;
  busy: boolean;
  vrf: boolean;
  gettingTool: boolean;
}

const START = '#7f5af0';

/** The hero's window for colours. back: the hero's own window, where it was opened from. */
export async function openPaint(hero: string, label: string, back: () => void): Promise<void> {
  const r = await window.api.paint.state(hero);
  if (r.error || !('layers' in r)) { toast(r.error || L`Не удалось прочитать файлы героя`, 'error'); return; }
  const installed = r.installed?.layers ?? null;
  const st: PaintState = {
    hero, label, back, layers: r.layers, installed,
    on: new Set(Object.keys(installed || {})),
    colors: new Map(Object.entries(installed || {})),
    all: Object.values(installed || {})[0] || START,
    busy: false,
    vrf: r.vrf,
    gettingTool: false,
  };
  openWindow(null, true, (key) => draw(key, st));
}

/** The colours the button would put on: a #rrggbb for each layer that is on. */
const wanted = (st: PaintState): Record<string, string> =>
  Object.fromEntries(st.layers.filter((l) => st.on.has(l.id)).map((l) => [l.id, st.colors.get(l.id) || st.all]));

const same = (a: Record<string, string>, b: Record<string, string> | null) =>
  !!b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k]?.toLowerCase() === v.toLowerCase());

function draw(key: number, st: PaintState): void {
  if (!isOpen(key)) return;
  const cell = (id: string): PaintCell | null => (st.layers.some((l) => l.id === id) ? { id, on: st.on.has(id), color: st.colors.get(id) || st.all } : null);
  const abilities = st.layers.filter((l) => l.kind === 'ability' || l.kind === 'abilityIcon')
    .reduce<{ key: string; name: string }[]>((out, l) => {
      const k = l.id.slice(l.id.indexOf(':') + 1);
      if (!out.some((a) => a.key === k)) out.push({ key: k, name: l.name || k });
      return out;
    }, []);
  const want = wanted(st);
  const named = st.layers.filter((l) => st.on.has(l.id)).map((l) => layerLabel(l));
  const m: PaintModalModel = {
    hero: st.label,
    all: st.all,
    abilities: abilities.map((a) => ({ name: a.name, effect: cell(`ability:${a.key}`), icon: cell(`abilityIcon:${a.key}`) })),
    own: { effects: cell('effects'), portrait: cell('portrait'), body: cell('body') },
    items: st.layers.filter((l) => l.kind === 'item').map((l) => ({ name: l.name || l.id, cell: cell(l.id)! })),
    summary: named.length ? named.slice(0, 4).join(', ') + (named.length > 4 ? ` +${named.length - 4}` : '') : '',
    action: !Object.keys(want).length
      ? { label: st.installed ? L`Включи хотя бы один слой` : L`Поставить`, icon: 'format_paint', off: true }
      : same(want, st.installed)
        ? { label: L`Стоит`, icon: 'check', off: true }
        : { label: st.installed ? L`Обновить` : L`Поставить`, icon: 'format_paint' },
    busy: st.busy,
    vrf: st.vrf,
    gettingTool: st.gettingTool,
  };
  const redraw = () => draw(key, st);
  showPaintModal(key, m, {
    back: st.back,
    close: closeOverlay,
    toggle: (id) => { if (st.on.has(id)) st.on.delete(id); else st.on.add(id); redraw(); },
    color: (id, hex) => { st.colors.set(id, hex); st.on.add(id); redraw(); },
    all: (hex) => { st.all = hex; for (const id of st.on) st.colors.set(id, hex); redraw(); },
    apply: () => void apply(key, st),
    getTool: () => void getTool(key, st),
  });
}

function layerLabel(l: PaintLayer): string {
  if (l.kind === 'effects') return L`атака и прочее`;
  if (l.kind === 'portrait') return L`портрет`;
  if (l.kind === 'body') return L`тело`;
  if (l.kind === 'abilityIcon') return L`иконка ${l.name || ''}`;
  return l.name || l.id;
}

/** ValveResourceFormat, downloaded once; the window says whether it came. */
async function getTool(key: number, st: PaintState): Promise<void> {
  if (st.gettingTool) return;
  st.gettingTool = true;
  draw(key, st);
  const r = await window.api.tools.install('vrf');
  st.gettingTool = false;
  if (r.error) toast(r.error, 'error', 8000);
  else st.vrf = true;
  draw(key, st);
}

async function apply(key: number, st: PaintState): Promise<void> {
  const want = wanted(st);
  if (st.busy || !Object.keys(want).length) return;
  st.busy = true;
  draw(key, st);
  const r = await window.api.paint.install(st.hero, want, st.label);
  st.busy = false;
  if (r.error || !('record' in r)) {
    toast(r.error || L`Не удалось перекрасить героя`, 'error', 8000);
  } else {
    st.installed = want;
    await refreshInstalledIndex();
    toast(L`Готово: ${st.label} в новых цветах. Запусти игру, чтобы увидеть.`, 'ok');
  }
  draw(key, st);
}
