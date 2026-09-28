/* The search in the title bar, which belongs to the window rather than to a screen: the catalog
 * draws its results wherever it was typed. */
import { state } from '../core/store.ts';
import { render, switchView, invalidateViews } from '../core/router.ts';
import { byId } from './dom.ts';

const input = byId<HTMLInputElement>('globalSearch');
const clear = byId('clearSearch');
let timer = 0;

input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    state.search = input.value;
    clear.classList.toggle('hidden', !state.search);
    // The catalog draws the results, and a catalog opened from another section is shown as it was
    // left unless it is marked out of date: a search typed on Settings opened the home screen with
    // no results on it (found by the simulation, tools/sim, 2026-09-24).
    if (state.view !== 'catalog') { invalidateViews(); switchView('catalog'); }
    else render();
  }, 180);
});

clear.addEventListener('click', () => {
  input.value = '';
  state.search = '';
  clear.classList.add('hidden');
  if (state.view === 'catalog') render();
  else invalidateViews(); // so the catalog does not come back still showing the old results
});
