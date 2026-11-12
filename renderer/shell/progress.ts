/* The progress bar over the status bar: a download with its size, a batch counted in items (how
 * many of how many, not a guessed percentage), a stage of work, and the end. The item table's build
 * has Cancel on it, which stops the build and puts back the change that started it
 * (src/build-undo.ts, issue #425). */
import { fmtMB } from '../ui/format.ts';
import { toast } from '../ui/toast.ts';
import { refreshInstalledIndex } from '../core/installed.ts';
import { render } from '../core/router.ts';
import { byId } from './dom.ts';

const bar = byId('progressBar');
const label = byId('progressLabel');
const size = byId('progressSize');
const fill = byId('progressFill');
const cancel = byId('progressCancel');
cancel.textContent = L`Отмена`;
let hideTimer = 0;

cancel.addEventListener('click', async () => {
  cancel.classList.add('hidden');
  const r = await window.api.patch.cancelBuild();
  if (!r.ok) {
    if (r.reason === 'unknown') toast(L`Эту сборку нельзя отменить: приложение не знает, что было в игре до неё`, 'error');
    return;
  }
  bar.classList.add('hidden');
  if (r.left.length) toast(L`Сборка отменена. Не вернулись: ${r.left.join(', ')}`, 'error', 8000);
  else toast(L`Сборка отменена, моды как были`);
  await refreshInstalledIndex();
  await render();
});

window.api.onProgress((evt) => {
  if (evt.type === 'download') {
    bar.classList.remove('hidden');
    cancel.classList.add('hidden');
    label.textContent = L`Скачивание: ${evt.label}`;
    if (evt.total > 0) {
      size.textContent = `${fmtMB(evt.loaded)} / ${fmtMB(evt.total)} MB`;
      fill.style.width = `${(evt.loaded / evt.total) * 100}%`;
    } else {
      size.textContent = `${fmtMB(evt.loaded)} MB`;
      fill.style.width = '40%';
    }
    clearTimeout(hideTimer);
  } else if (evt.type === 'count') {
    bar.classList.remove('hidden');
    cancel.classList.toggle('hidden', evt.cancel !== 'schema');
    label.textContent = evt.label;
    size.textContent = `${evt.done} / ${evt.total}`;
    fill.style.width = `${evt.total ? (evt.done / evt.total) * 100 : 0}%`;
    clearTimeout(hideTimer);
  } else if (evt.type === 'stage') {
    label.textContent = `${evt.label}: ${evt.stage}`;
    fill.style.width = '95%';
  } else if (evt.type === 'done' || evt.type === 'error') {
    cancel.classList.add('hidden');
    fill.style.width = '100%';
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => bar.classList.add('hidden'), 800);
  }
});
