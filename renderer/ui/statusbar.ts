/* The two switches in the status bar, and the state behind them.
 *
 * Master mods on or off, and safe mode. Any screen that changes what is installed has to
 * ask these to redraw, so the painting lives apart from the buttons: the click handlers
 * stay with the rest of the shell wiring in app.js, because turning safe mode off also
 * reloads the cosmetic slots and the catalog rail, and none of that belongs here.
 */
import { state } from '../core/store.ts';
import { $ } from '../core/dom.ts';

// Small, and only fetched where it's actually shown: the safe-mode switch's warning dot
// and the Library's schema-conflict banner (see paintSafeModeSwitch / renderLibrary).
export async function refreshPatchState(): Promise<void> {
  state.patchState = await window.api.patch.state();
  paintSafeModeSwitch();
}

export function paintMasterSwitch(): void {
  const btn = $('#modsMasterBtn');
  if (!btn) return;
  const on = !state.masterOff;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', String(on));
  $('#modsMasterState').textContent = on ? L`вкл` : L`выкл`;
}

export async function refreshMasterSwitch(): Promise<void> {
  try {
    const r = await window.api.mods.masterState();
    state.masterOff = !!r.off;
  } catch { state.masterOff = false; }
  paintMasterSwitch();
}

// ---------- safe mode (item-schema patch) ----------
//
// Off (safe, default) leaves the game untouched; on registers game/dota_mods in
// gameinfo_branchspecific.gi and re-signs it in dota.signatures, which is what lets Dota
// read the item-schema effects mods carry and the free cosmetics catalog. See src/patcher.js.

export function paintSafeModeSwitch(): void {
  const btn = $('#safeModeBtn');
  if (!btn) return;
  const safe = !state.settings?.schemaPatch;
  btn.classList.toggle('on', safe);
  btn.setAttribute('aria-checked', String(safe));
  $('#safeModeState').textContent = safe ? L`вкл` : L`выкл`;
  const icon = btn.querySelector('.safe-switch-icon');
  if (icon) icon.textContent = safe ? 'shield' : 'shield_moon';
  // something needs attention: the patch fell off, the schema is stale, two mods want the
  // same item, or another patcher is already in gameinfo — a dot, checked only when unsafe
  const st = state.patchState;
  // `signable` is false where the game ships no signature list at all, which is every Linux
  // install: an unsigned patch there is the finished state, not a warning
  const trouble = !safe && st && (st.stale || !st.patched || (st.signable && !st.signed)
    || (st.conflicts || []).length || st.foreign);
  btn.classList.toggle('trouble', !!trouble);
}

// The left of the bar: whether Dota was found. Which folder inside the game the mods land in
// is the app's business, not the user's - the full path is in Settings and in a diagnostics
// report, which is where somebody actually chasing a problem goes.
export async function refreshSidebarStatus(): Promise<void> {
  const s = await window.api.settings.get();
  state.settings = s;
  const dotEl = $('#dotaStatusDot');
  const txtEl = $('#dotaStatusText');
  if (s.dotaPathValid) {
    dotEl.className = 'dot ok';
    txtEl.textContent = L`Dota 2 подключена`;
  } else {
    dotEl.className = 'dot bad';
    txtEl.textContent = L`Dota 2 не найдена — укажи путь в настройках`;
  }
}
