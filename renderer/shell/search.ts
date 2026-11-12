/* The search in the title bar, which belongs to the window rather than to a screen: the catalog
 * draws its results wherever it was typed. It is remembered (catalog/prefs.ts), so it is still
 * there after a restart and after another category is picked, where it narrows that category. */
import { state } from '../core/store.ts';
import { render, switchView, invalidateViews } from '../core/router.ts';
import { prefs, remember } from '../views/catalog/state.ts';
import { byId } from './dom.ts';

const input = byId<HTMLInputElement>('globalSearch');
const clear = byId('clearSearch');
let timer = 0;

// the last search, back where it was left; the catalog's first draw shows its results
const saved = prefs().search;
if (saved) {
  input.value = saved;
  state.search = saved;
  clear.classList.remove('hidden');
}

input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    // a search begun is a search of everything: a category picked after it narrows to it
    if (!state.search.trim() && input.value.trim()) state.activeCategory = 'all';
    state.search = input.value;
    remember({ search: state.search });
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
  remember({ search: '' });
  clear.classList.add('hidden');
  if (state.view === 'catalog') render();
  else invalidateViews(); // so the catalog does not come back still showing the old results
});
