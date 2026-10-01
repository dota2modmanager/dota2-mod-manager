/* What the user already has, indexed so any screen can ask about one mod.
 *
 * The catalog asks to grey out an install button, the library asks to draw a row, the
 * cosmetics screen asks what currently dresses a slot. All three read the same index, and
 * it is rebuilt from one call rather than each screen fetching its own list.
 */
import { state } from './store.js';
import { $ } from './dom.js';
import { invalidateViews } from './router.js';
import { keyOf } from './keys.js';

export { keyOf };

// label for a fingerprint match (array of catalog identities that share the content)
export function matchLabel(matches) {
  return matches.map((m) => m.name + (m.styleLabel ? ` · ${m.styleLabel}` : '')).join(' / ');
}

// refresh the catalog "installed" lookup + the library tab counter from a list
export function applyInstalled(installed) {
  state.installedIndex.clear();
  state.cosmeticPicks.clear();
  for (const rec of installed) {
    state.installedIndex.set(keyOf(rec.categoryId, rec.name, rec.styleLabel), rec);
    // What is live in a cosmetic slot is read from the records themselves, not from the
    // slot list: the option lists only change when the game does, while a pick can be
    // deleted or switched off from the Library at any moment.
    if (rec.categoryId === 'cosmetic' && rec.slot && rec.enabled !== false) state.cosmeticPicks.set(rec.slot, rec);
  }
  // tools live in the index so their card knows it has them, but they are not in the Library
  // and must not be counted on its tab
  $('#libCount').textContent = installed.filter((r) => r.categoryId !== 'tools').length || '';

  // Screens that are not on show keep what they built, so somebody has to tell them the
  // folder moved under them - a mod installed from the catalog changes a row in the Library
  // and a badge on a card. Compared rather than announced every time: opening the Library
  // re-reads the folder on each visit, and an unchanged read must not throw away the catalog
  // the user is about to switch back to.
  // Sorted, because the folder is read again on every visit to the Library and the order it
  // comes back in is not promised. Comparing an unsorted join made an identical read look
  // like a change, and the catalog was thrown away for nothing.
  const sig = installed.map((r) => `${r.id}:${r.enabled === false ? 0 : 1}:${r.slot ?? ''}`).sort().join('|');
  if (sig !== lastInstalledSig) { lastInstalledSig = sig; invalidateViews(); }
}

// what applyInstalled() last saw, so it can tell a real change from a re-read
let lastInstalledSig = null;

// the record that currently dresses a cosmetic slot, if any
export function pickedIn(slot) {
  return state.cosmeticPicks.get(slot) || null;
}

// Every cosmetic slot the game's schema exposes, with its options and current pick. Not
// folded into refreshInstalledIndex(): the option lists run to a couple hundred KB and
// most of the app's actions (toggling a regular mod, searching the catalog) never need
// them, so this is fetched only where a cosmetic pick could actually have changed.
export async function refreshCosmeticSlots() {
  const { slots, sets } = await window.api.cosmetics.slots();
  state.cosmeticSlots = slots || [];
  state.cosmeticSets = sets || []; // the item builder's sets, read with the slots they fill
  // only called where a cosmetic pick or safe mode could have moved, and both of those
  // change the catalog's rail as well as the screen asking - so nothing kept is still right
  invalidateViews();
}

export async function refreshInstalledIndex() {
  const { installed } = await window.api.mods.list();
  applyInstalled(installed);
}
