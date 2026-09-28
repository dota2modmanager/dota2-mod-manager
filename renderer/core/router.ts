/* Which screen is showing, and how to get to another one.
 *
 * Screens have to be able to send the user elsewhere - a mod card jumps to the library, an
 * empty library points at the catalog - but if each screen imported the others, the graph
 * would be a knot and nothing could be extracted from app.js without dragging the rest
 * along. So screens do not know each other: each registers its render under a name, and
 * this is the only module that holds the map. Screens import the router, never the reverse.
 *
 * A screen is also built once and kept. Every switch used to rebuild the one being opened
 * from nothing: coming back to Heroes meant 513 cards and 6645 nodes again, and around 90ms
 * of frozen window each time, for a screen the user had been looking at a second earlier.
 * Each screen now owns an element that stays in the page, and switching shows it.
 *
 * What keeps a kept screen honest is the stale list. Anything that moves what screens read -
 * a mod installed or switched off, safe mode flipped, the whole window redrawn - says so
 * through invalidateViews(), and a switch to a screen on that list rebuilds it exactly as
 * before. Showing what is already built is only ever the answer when nothing has happened.
 *
 * Redrawing the screen you are already on never goes through the list: changing the sort or
 * opening a category concerns the catalog and nobody else, and those call their own render
 * directly, as they always did.
 */
import { state } from './store.ts';
import { $ } from './dom.ts';
import { screenChanging, paint } from '../ui/transitions.js';

/** What a screen does to draw itself; some fetch first, and the switch waits for them. */
type Draw = () => unknown;

const screens = new Map<string, Draw>();
const panes = new Map<string, HTMLElement>();

// screens whose picture no longer matches the data; rebuilt when they are next opened
const stale = new Set<string>();
// where each screen was left. #main is the scroller and it is shared, so without this a
// screen opens at whatever offset the previous one happened to be at.
const scrolls = new Map<string, number>();

/** Give a name a way to draw itself. Called once per screen, as it is loaded. */
export function registerView(name: string, render: Draw): void {
  screens.set(name, render);
}

/** The element a screen owns and draws into. Created on first ask, then kept. */
export function pane(name: string): HTMLElement {
  let el = panes.get(name);
  if (!el) {
    el = document.createElement('div');
    el.className = 'view-pane';
    el.dataset.pane = name;
    el.hidden = name !== state.view;
    $('#view-root').appendChild(el);
    panes.set(name, el);
  }
  return el;
}

/**
 * Something changed that the screens nobody is looking at have not seen. Call it from
 * whatever did the changing, not from the screen that noticed - the screen on show is
 * redrawing itself anyway, and marking it would only make it draw twice.
 */
export function invalidateViews(): void {
  for (const name of screens.keys()) if (name !== state.view) stale.add(name);
}

function showPane(view: string): void {
  for (const [name, el] of panes) el.hidden = name !== view;
}

/** Redraw whatever is showing, because something under it changed. A name with nothing
 *  registered draws nothing rather than throwing: a half-extracted screen should leave a
 *  blank area, not a broken window. */
export function render(): unknown {
  invalidateViews();
  stale.delete(state.view);
  const draw = screens.get(state.view);
  return draw ? draw() : undefined;
}

export function switchView(view: string): Promise<void> {
  const main = $('#main');
  scrolls.set(state.view, main.scrollTop);
  document.querySelectorAll<HTMLElement>('.tb-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  state.view = view;
  const railOff = view !== 'catalog';
  $('#catRail').classList.toggle('hidden', railOff);
  $('#gripRail').classList.toggle('hidden', railOff); // nothing to resize without the rail
  document.body.classList.toggle('rail-off', railOff || !!state.panels.railFolded);
  // a scrolled-away tab must not stay out of sight once it is the active one
  document.querySelector('.tb-tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  window.api.presence.view(view); // what Discord shows the user is doing

  const el = pane(view);
  const kept = !stale.has(view) && el.childElementCount > 0;
  stale.delete(view);
  const settled = () => { main.scrollTop = scrolls.get(view) || 0; };
  if (kept) {
    // nothing to build, so the swap is the whole update and gets the transition to itself
    screenChanging();
    return paint(() => showPane(view)).then(settled);
  }
  // The screen animates in when it paints, not now: it may have to fetch first, and a
  // transition started here would hold the old picture on screen for the whole wait. The
  // swap goes with it, so an empty new screen is never on show during that fetch.
  screenChanging(() => showPane(view));
  const draw = screens.get(view);
  // the swap again for a screen that returned without painting - an unregistered name, or
  // one that bailed early - so a tab click can never leave the window on the old screen
  return Promise.resolve(draw ? draw() : undefined).then(() => { showPane(view); settled(); });
}
