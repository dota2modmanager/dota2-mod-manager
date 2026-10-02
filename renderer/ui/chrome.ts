/* The window's own geometry: how big the chrome is and how big everything reads.
 *
 * Two scales that are deliberately not one. The content scale is CSS zoom on the view, so a
 * user who wants bigger cards gets them without the titlebar growing to match; each chrome
 * panel then has a size and a zoom of its own, dragged from its edge. A window zoom would
 * have been one number for all of it, and it landed a frame late, which made the layout
 * shudder under the wheel.
 *
 * The shell drives this from Ctrl + wheel and the panel grips; Settings drives the same
 * values from its sliders. That is why it lives apart from either.
 */
import { $ } from '../core/dom.ts';
import { state } from '../core/store.ts';
import { PANEL_DEFAULTS, PANEL_LIMITS, PANEL_ZOOM_LIMITS, type Panels, type PanelSize } from '../core/constants.ts';

type PanelZoom = 'topZoom' | 'bottomZoom' | 'railZoom';
type PanelFold = 'topFolded' | 'bottomFolded' | 'railFolded';

// Scale of the content — the catalog, the library, the settings — in percent. It is CSS zoom
// on the content itself, deliberately not a window zoom: the panels have their own scale, and
// a window zoom lands a frame after the CSS does, which made the whole layout shudder while
// the wheel was turning. Ctrl +/-/0 come from src/main-window.ts (there they also block Electron's own
// zoom accelerators); Ctrl + wheel and the slider in Settings land here.
const SCALE_MIN = 70;
const SCALE_MAX = 160;
export const clampScale = (pct: unknown): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(Number(pct) / 5) * 5));
export const currentScalePct = (): number => Math.round((Number(state.settings?.uiScale) || 1) * 100);

// keep a slider and its readout in step with the value that is actually in force
function paintScaleRow(id: string, pct: number): void {
  const range = document.querySelector<HTMLInputElement>(`#${id}`);
  if (range) range.value = String(pct);
  const val = document.querySelector(`#${id}Val`);
  if (val) val.textContent = `${pct}%`;
}

// the content scale doubles as the "everything" number in Settings
export function paintScale(pct: number): void {
  paintScaleRow('zoomContent', pct);
  paintScaleRow('masterRange', pct);
}

function paintPanelScales(): void {
  paintScaleRow('zoomTop', Math.round(state.panels.topZoom * 100));
  paintScaleRow('zoomRail', Math.round(state.panels.railZoom * 100));
  paintScaleRow('zoomBottom', Math.round(state.panels.bottomZoom * 100));
}

export function applyContentZoom(factor: number): void {
  if (state.settings) state.settings.uiScale = factor;
  document.documentElement.style.setProperty('--content-zoom', String(factor));
  paintScale(Math.round(factor * 100));
}

// paints first, saves after: the wheel can outrun the IPC and must not wait for it
export function applyScalePct(pct: number): void {
  const want = clampScale(pct);
  applyContentZoom(want / 100);
  window.api.ui.setZoom(want / 100);
}

// Ctrl + wheel resizes whatever the pointer is over: each chrome panel has its own size,
// and everywhere else means the content, which is what the UI scale governs.
const WHEEL_ZONES: { sel: string; zoom: PanelZoom; fold: PanelFold }[] = [
  { sel: '#titlebar, #gripTop', zoom: 'topZoom', fold: 'topFolded' },
  { sel: '#statusbar, #gripBottom', zoom: 'bottomZoom', fold: 'bottomFolded' },
  { sel: '#catRail, #gripRail', zoom: 'railZoom', fold: 'railFolded' },
];

window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const dir = e.deltaY < 0 ? 1 : -1;
  const target = e.target;
  const zone = target instanceof Element ? WHEEL_ZONES.find((z) => target.closest(z.sel)) : null;
  if (!zone) { applyScalePct(currentScalePct() + dir * 5); return; }
  if (state.panels[zone.fold]) foldPanel(zone.fold, false); // scaling a folded panel opens it
  state.panels[zone.zoom] = clampPanelZoom(state.panels[zone.zoom] + dir * 0.05);
  paintPanels();
  savePanels();
}, { passive: false });

// the main process took a Ctrl +/-/0 press — keep the slider and the chrome honest
window.api.ui.onZoom((factor) => applyContentZoom(factor));

// ---------- panels ----------

/** Whatever settings.json holds for the panels, made into sizes the window can use. */
export function readPanels(saved: unknown): Panels {
  const p = { ...PANEL_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) } as Panels;
  for (const [key, [min, max]] of Object.entries(PANEL_LIMITS) as [PanelSize, [number, number]][]) {
    const v = Math.round(Number(p[key]));
    p[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : PANEL_DEFAULTS[key];
  }
  for (const key of ['topZoom', 'bottomZoom', 'railZoom'] as const) {
    const v = Number(p[key]);
    p[key] = Number.isFinite(v) ? clampPanelZoom(v) : 1;
  }
  for (const key of ['topFolded', 'bottomFolded', 'railFolded'] as const) p[key] = !!p[key];
  return p;
}

export const clampPanelZoom = (v: number): number => Math.round(Math.min(PANEL_ZOOM_LIMITS[1], Math.max(PANEL_ZOOM_LIMITS[0], v)) * 100) / 100;

function paintGripToggle(sel: string, icon: string, label: string): void {
  const btn = document.querySelector<HTMLElement>(sel);
  if (!btn) return;
  const glyph = btn.querySelector('.ms');
  if (glyph) glyph.textContent = icon;
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

export function paintPanels(): void {
  const p = state.panels;
  const root = document.documentElement.style;
  root.setProperty('--tb-h', `${p.topH}px`);
  root.setProperty('--status-h', `${p.bottomH}px`);
  root.setProperty('--rail-w', `${p.railW}px`);
  root.setProperty('--top-zoom', String(p.topZoom));
  root.setProperty('--bottom-zoom', String(p.bottomZoom));
  root.setProperty('--rail-zoom', String(p.railZoom));
  document.body.classList.toggle('top-folded', p.topFolded);
  document.body.classList.toggle('bottom-folded', p.bottomFolded);
  document.body.classList.toggle('rail-folded', p.railFolded);
  document.body.classList.toggle('rail-off', p.railFolded || state.view !== 'catalog');
  paintPanelScales();
  paintGripToggle('#topToggle', p.topFolded ? 'expand_more' : 'expand_less',
    p.topFolded ? L`Развернуть верхнюю панель` : L`Свернуть верхнюю панель`);
  paintGripToggle('#bottomToggle', p.bottomFolded ? 'expand_less' : 'expand_more',
    p.bottomFolded ? L`Показать нижнюю панель` : L`Скрыть нижнюю панель`);
  paintGripToggle('#railToggle', p.railFolded ? 'chevron_right' : 'chevron_left',
    p.railFolded ? L`Показать категории` : L`Скрыть категории`);
}

let panelSaveTimer = 0;
export function savePanels(): void {
  clearTimeout(panelSaveTimer);
  panelSaveTimer = window.setTimeout(() => { window.api.settings.set('panels', state.panels); }, 250);
}

function foldPanel(key: PanelFold, on?: boolean): void {
  state.panels[key] = on === undefined ? !state.panels[key] : !!on;
  paintPanels();
  savePanels();
}

// drag the edge itself; the chevron sitting on it folds the panel instead
type Grip = { size: PanelSize; zoom: PanelZoom; fold: PanelFold; delta: (ev: PointerEvent, origin: { x: number; y: number }) => number };

function bindGrip(sel: string, { size: sizeKey, zoom: zoomKey, fold: foldKey, delta }: Grip): void {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.grip-toggle')) return;
    if (state.panels[foldKey]) foldPanel(foldKey, false); // dragging a folded panel opens it
    const [min, max] = PANEL_LIMITS[sizeKey];
    const start = state.panels[sizeKey];
    // the pointer moves in viewport pixels, the panel is sized in its own, which its zoom
    // multiplies — so a 1px drag is 1/zoom of the panel's own
    const perPixel = 1 / state.panels[zoomKey];
    const origin = { x: e.clientX, y: e.clientY };
    el.classList.add('dragging');
    document.body.classList.add('grip-dragging');
    // the window, not the grip: the grip moves out from under the pointer as the panel
    // grows, and pointer capture is not something to depend on for that
    const move = (ev: PointerEvent) => {
      state.panels[sizeKey] = Math.min(max, Math.max(min, Math.round(start + delta(ev, origin) * perPixel)));
      paintPanels();
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      el.classList.remove('dragging');
      document.body.classList.remove('grip-dragging');
      savePanels();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });
  el.addEventListener('dblclick', () => {
    state.panels[sizeKey] = PANEL_DEFAULTS[sizeKey];
    state.panels[zoomKey] = 1;
    paintPanels();
    savePanels();
  });
}

// The tab strip runs out of room on a small window or a high UI scale, and then it scrolls:
// sideways with the wheel, or by grabbing and swiping it like a strip on a phone.
export function syncNavOverflow(): void {
  const nav = document.querySelector<HTMLElement>('#tbNav');
  if (nav) nav.classList.toggle('scrollable', nav.scrollWidth > nav.clientWidth + 1);
}

function bindNavScroll(): void {
  const nav = document.querySelector<HTMLElement>('#tbNav');
  if (!nav) return;
  new ResizeObserver(syncNavOverflow).observe(nav);
  syncNavOverflow();

  // the bar drops the wordmark when it gets cramped — measured on the bar itself, since its
  // own zoom decides how much room it really has
  const tb = document.querySelector<HTMLElement>('#titlebar');
  if (tb) {
    const syncWidth = () => {
      tb.classList.toggle('narrow', tb.clientWidth < 1000);
      tb.classList.toggle('tiny', tb.clientWidth < 870);
    };
    new ResizeObserver(syncWidth).observe(tb);
    syncWidth();
  }

  nav.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // that gesture belongs to the panel size
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta || nav.scrollWidth <= nav.clientWidth) return;
    e.preventDefault();
    nav.scrollLeft += delta;
  }, { passive: false });

  let drag: { id: number; x: number; left: number; moved: boolean } | null = null;
  let swallowClick = false;
  nav.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || nav.scrollWidth <= nav.clientWidth) return;
    drag = { id: e.pointerId, x: e.clientX, left: nav.scrollLeft, moved: false };
  });
  // on the window: a swipe often runs past the strip, and it must keep scrolling anyway
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 4) return; // still a click, not a swipe
      drag.moved = true;
      nav.classList.add('dragging');
    }
    nav.scrollLeft = drag.left - dx;
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) swallowClick = true; // a swipe must not also switch the view
    nav.classList.remove('dragging');
    drag = null;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  nav.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

export function bindPanels(): void {
  bindGrip('#gripTop', { size: 'topH', zoom: 'topZoom', fold: 'topFolded', delta: (ev, o) => ev.clientY - o.y });
  bindGrip('#gripBottom', { size: 'bottomH', zoom: 'bottomZoom', fold: 'bottomFolded', delta: (ev, o) => o.y - ev.clientY });
  bindGrip('#gripRail', { size: 'railW', zoom: 'railZoom', fold: 'railFolded', delta: (ev, o) => ev.clientX - o.x });
  $('#topToggle')?.addEventListener('click', () => foldPanel('topFolded'));
  $('#bottomToggle')?.addEventListener('click', () => foldPanel('bottomFolded'));
  $('#railToggle')?.addEventListener('click', () => foldPanel('railFolded'));
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return;
    e.preventDefault();
    foldPanel('railFolded');
  });
  bindNavScroll();
  paintPanels();
}
