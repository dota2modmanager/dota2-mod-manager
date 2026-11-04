/* The status bar's buttons: launching the game and the switch that turns every mod off at once.
 * Safe mode had a switch here until 3.0; the item table is now asked for where it is needed
 * (ui/game-files.ts). */
import { state } from '../core/store.ts';
import { render, invalidateViews } from '../core/router.ts';
import { toast } from '../ui/toast.ts';
import { paintMasterSwitch } from '../ui/statusbar.ts';
import { byId } from './dom.ts';

document.getElementById('launchBtn')?.addEventListener('click', async () => {
  if (!state.settings?.dotaPathValid) { toast(L`Сначала укажи путь к Dota 2 в настройках`, 'warn'); return; }
  // the game starts once the item table being built is written (the bar above counts it), so
  // the button stays pressed until then rather than taking a second press
  const btn = byId<HTMLButtonElement>('launchBtn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  let warning: string | null | undefined = null;
  try {
    ({ warning } = await window.api.game.launch());
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
  if (warning) { toast(warning, 'warn', 9000, { label: L`Загрузки Steam`, run: () => { void window.api.game.steamDownloads(); } }); return; }
  toast(state.masterOff ? L`Запуск Dota 2 без модов…` : L`Запуск Dota 2 с модами…`);
});

document.getElementById('modsMasterBtn')?.addEventListener('click', async () => {
  const btn = byId<HTMLButtonElement>('modsMasterBtn');
  btn.disabled = true;
  const enable = state.masterOff; // currently off -> turn on, and vice-versa
  const r = await window.api.mods.setMaster(enable);
  btn.disabled = false;
  if (r.error) { toast(r.error, 'error'); return; }
  state.masterOff = !enable;
  paintMasterSwitch();
  toast(enable ? L`Моды включены` : L`Моды выключены — игра запустится ванильной`);
  // My mods draws every row from this, and it keeps what it built while you are elsewhere
  invalidateViews();
  if (state.view === 'library') render();
});
