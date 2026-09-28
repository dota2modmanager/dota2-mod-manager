/* The status bar's buttons: launching the game, the switch that turns every mod off at once, and
 * safe mode, which keeps the game's own files untouched and the effects and free cosmetics off. */
import { COSMETIC_PREFIX } from '../core/constants.js';
import { state } from '../core/store.js';
import { render, invalidateViews } from '../core/router.js';
import { refreshCosmeticSlots } from '../core/installed.js';
import { toast } from '../ui/toast.js';
import { safeModeDialog } from '../ui/dialog.js';
import { refreshPatchState, paintMasterSwitch } from '../ui/statusbar.js';
import { byId } from './dom.ts';

document.getElementById('launchBtn')?.addEventListener('click', async () => {
  if (!state.settings?.dotaPathValid) { toast(L`Сначала укажи путь к Dota 2 в настройках`, 'warn'); return; }
  await window.api.game.launch();
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

document.getElementById('safeModeBtn')?.addEventListener('click', async () => {
  const btn = byId<HTMLButtonElement>('safeModeBtn');
  const turningUnsafe = !state.settings?.schemaPatch; // currently safe -> about to turn it off
  if (turningUnsafe && !await safeModeDialog()) return;
  btn.disabled = true;
  const r = await window.api.patch.setEnabled(turningUnsafe);
  btn.disabled = false;
  if (r.error) { toast(r.error, 'error'); return; }
  state.settings = { ...state.settings, schemaPatch: turningUnsafe };
  toast(turningUnsafe ? L`Безопасный режим выключен — эффекты и косметика доступны` : L`Безопасный режим включён, файлы игры восстановлены. Эффекты и косметика ждут, пока не выключишь его снова.`);
  await Promise.all([refreshCosmeticSlots(), refreshPatchState()]);
  if (state.view === 'catalog') {
    // the cosmetics rail section just appeared or disappeared: leave a category that no longer
    // exists rather than show a dead one
    if (!turningUnsafe && state.activeCategory.startsWith(COSMETIC_PREFIX)) state.activeCategory = 'all';
    render();
  }
});
