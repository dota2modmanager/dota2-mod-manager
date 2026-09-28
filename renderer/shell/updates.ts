/* News that arrives while the window is open: a new version of the app, and Dota patching itself
 * underneath the mods. */
import { state } from '../core/store.ts';
import { render } from '../core/router.ts';
import { switchOffStaleTerrains } from '../core/terrain-age.ts';
import { esc } from '../ui/format.js';
import { toast } from '../ui/toast.js';

/** A bar along the bottom of the window, with its buttons wired by the caller. */
function updateBar(html: string): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.innerHTML = html;
  document.body.appendChild(bar);
  return bar;
}
const on = (bar: HTMLElement, id: string, fn: (btn: HTMLButtonElement) => void) =>
  bar.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', (e) => fn(e.currentTarget as HTMLButtonElement));

window.api.update.onUpdate((evt) => {
  if (evt.type === 'available') {
    toast(L`Найдено обновление v${evt.version} — скачиваю в фоне…`, 'ok', 6000);
  } else if (evt.type === 'portable') {
    // A portable copy cannot install over itself, so the new build is fetched to sit beside it and
    // this turns into "it is there, go run it". Nothing on disk is replaced.
    const bar = updateBar(`
      <span class="ms">system_update_alt</span>
      <span>${L`Вышла версия `}<b>v${esc(evt.version)}</b></span>
      <button class="btn btn-sm btn-primary" id="portableGetBtn">${L`Скачать рядом`}</button>
      <button class="btn btn-sm btn-ghost" id="portableLaterBtn">${L`Позже`}</button>`);
    on(bar, 'portableLaterBtn', () => bar.remove());
    on(bar, 'portableGetBtn', async (btn) => {
      btn.disabled = true;
      const r = await window.api.update.fetchPortable();
      if (r?.error) { toast(r.error, 'error', 7000); btn.disabled = false; return; }
      bar.innerHTML = `
        <span class="ms">check_circle</span>
        <span>${L`Новая версия лежит рядом: `}<b>${esc(r.name)}</b>${L`. Закрой это окно и запусти её.`}</span>
        <button class="btn btn-sm btn-primary" id="portableShowBtn">${L`Показать файл`}</button>
        <button class="btn btn-sm btn-ghost" id="portableCloseBtn">${L`Понятно`}</button>`;
      on(bar, 'portableShowBtn', () => window.api.update.revealPortable(r.path));
      on(bar, 'portableCloseBtn', () => bar.remove());
    });
  } else if (evt.type === 'downloaded') {
    const bar = updateBar(`
      <span class="ms">system_update_alt</span>
      <span>${L`Обновление `}<b>v${esc(evt.version)}</b>${L` готово к установке`}</span>
      <button class="btn btn-sm btn-primary" id="updateNowBtn">${L`Перезапустить и обновить`}</button>
      <button class="btn btn-sm btn-ghost" id="updateLaterBtn">${L`Позже`}</button>`);
    on(bar, 'updateNowBtn', () => window.api.update.install());
    on(bar, 'updateLaterBtn', () => bar.remove());
  }
});

// The repair itself runs in the main process whether or not this window is looking; this only
// decides how the user hears about it. On My mods that is the banner, so redraw and let it speak;
// anywhere else a toast, because a patch that ate the mods is news wherever you are standing.
window.api.patch.onRepair((st) => {
  // an update can change the map under a whole-map terrain (core/terrain-age.ts)
  if (st.state === 'done') switchOffStaleTerrains().then((off: unknown[]) => { if (off.length && state.view === 'library') render(); });
  if (state.view === 'library') { render(); return; }
  if (st.state === 'waiting') toast(L`Dota обновилась — вернём моды, как только закроешь игру`, 'warn', 8000);
  else if (st.state === 'failed') toast(L`Dota обновилась, вернуть моды не вышло — загляни в «Мои моды»`, 'error', 8000);
  else if (st.state === 'done') toast(L`Dota обновилась — моды на месте`, 'ok', 6000);
});
