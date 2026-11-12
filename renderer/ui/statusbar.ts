/* The status bar's switch, and the state behind it and the item table.
 *
 * Master mods on or off. Any screen that changes what is installed has to ask it to redraw, so
 * the painting lives apart from the button, whose click handler is in shell/switches.ts.
 */
import { state } from '../core/store.ts';
import { $ } from '../core/dom.ts';

// Small, and only fetched where it is shown: My mods' banners about the item table and the
// "Game files" block in Settings (src/schema-service.ts state).
export async function refreshPatchState(): Promise<void> {
  state.patchState = await window.api.patch.state();
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

// The left of the bar: whether Dota was found, not whether it is running. It said "connected",
// which read as the game being open, and was lit with the game closed. Which folder inside the game the mods land in
// is the app's business, not the user's - the full path is in Settings and in a diagnostics
// report, which is where somebody actually chasing a problem goes.
// Dota open is said here too: the app stays up beside the game for the catalog and the presets,
// and nothing is written to the game until it closes (src/game-watch.ts)
let gameOpen = false;
window.api.game.onRunning((running) => {
  gameOpen = running;
  void refreshSidebarStatus();
});

export async function refreshSidebarStatus(): Promise<void> {
  const s = await window.api.settings.get();
  state.settings = s;
  const dotEl = $('#dotaStatusDot');
  const txtEl = $('#dotaStatusText');
  if (s.dotaPathValid && gameOpen) {
    dotEl.className = 'dot warn';
    txtEl.textContent = L`Dota 2 открыта: закрой её, чтобы ставить моды`;
    txtEl.parentElement?.setAttribute('title', L`Пока игра открыта, она держит свои файлы, и моды не ставятся и не переключаются. Каталог, избранное и пресеты работают.`);
  } else if (s.dotaPathValid) {
    txtEl.parentElement?.removeAttribute('title');
    dotEl.className = 'dot ok';
    txtEl.textContent = L`Dota 2 найдена`;
  } else {
    dotEl.className = 'dot bad';
    txtEl.textContent = L`Dota 2 не найдена — укажи путь в настройках`;
  }
}
