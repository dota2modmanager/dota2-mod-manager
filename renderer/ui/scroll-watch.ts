/* A watch on the wheel, for issue #330: now and then a pane stops scrolling although its
 * scrollbar says there is more below, and it has not been caught on a machine that could look
 * inside. When a few ticks in a row leave a pane that has room exactly where it was, the window
 * writes what it sees into the app's log (diag:rendererError), so the next report that says
 * "scrolling broke" carries the state it broke in: the pane, its sizes, the zoom, what was under
 * the pointer, whether a screen change was on show. Once a minute at most.
 *
 * The first such report from a machine that could look (2026-11-04) showed the wheel reaching the
 * main pane with 1580 px still below, no screen change and no dialog: nothing of ours held it, the
 * browser just did not move. Clicking around let it go. So from the second stuck tick in a row
 * the watch scrolls the pane itself, by the tick's own distance. A tick something took on purpose
 * (the 3D preview zooms on it) is left alone. */
import { scrollerAt, transitioning } from './transitions.ts';
import { NUDGE_AFTER, stuck, tickPx, type Tick } from '../core/scroll-stuck.ts';

const IN_A_ROW = 3;
const QUIET_MS = 60_000;
let streak = 0;
let said = 0;

/** A short name for an element in the log: tag, id and first class. */
const nameOf = (el: Element | null): string =>
  el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList[0] ? `.${el.classList[0]}` : ''}` : 'none';

function report(pane: HTMLElement, tick: Tick, e: WheelEvent): void {
  const style = getComputedStyle(pane);
  const state = {
    pane: nameOf(pane), under: nameOf(document.elementFromPoint(e.clientX, e.clientY)), target: nameOf(e.target as Element),
    scrollTop: Math.round(tick.after), scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, max: tick.max,
    overflowY: style.overflowY, zoom: style.zoom, contentZoom: document.documentElement.style.getPropertyValue('--content-zoom') || '1',
    window: `${innerWidth}x${innerHeight}@${devicePixelRatio}`, screenChange: transitioning(),
    view: document.querySelector('.view-pane:not([hidden])')?.id || '', modal: Boolean(document.querySelector('.overlay:not(.hidden)')),
  };
  window.api.diag.reportError(`scroll stuck (#330): ${JSON.stringify(state)}`);
}

document.addEventListener('wheel', (e) => {
  if (e.ctrlKey || !e.deltaY) return;
  const pane = scrollerAt(e.clientX, e.clientY);
  if (!pane) return;
  const before = pane.scrollTop;
  // the browser scrolls after the event; two frames is when it has
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const tick = { dy: e.deltaY, before, after: pane.scrollTop, max: pane.scrollHeight - pane.clientHeight };
    streak = !e.defaultPrevented && stuck(tick) ? streak + 1 : 0;
    if (streak >= NUDGE_AFTER) pane.scrollBy({ top: tickPx(e.deltaY, e.deltaMode, pane.clientHeight), behavior: 'instant' });
    // the streak is not reset here: the ticks after the report still need the nudge
    if (streak < IN_A_ROW || Date.now() - said < QUIET_MS) return;
    said = Date.now();
    report(pane, tick, e);
  }));
}, { capture: true, passive: true });
