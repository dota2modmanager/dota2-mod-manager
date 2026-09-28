/* The progress bar over the status bar: a download with its size, a batch counted in items (how
 * many of how many, not a guessed percentage), a stage of work, and the end. */
import { fmtMB } from '../ui/format.js';
import { byId } from './dom.ts';

const bar = byId('progressBar');
const label = byId('progressLabel');
const size = byId('progressSize');
const fill = byId('progressFill');
let hideTimer = 0;

window.api.onProgress((evt) => {
  if (evt.type === 'download') {
    bar.classList.remove('hidden');
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
    label.textContent = evt.label;
    size.textContent = `${evt.done} / ${evt.total}`;
    fill.style.width = `${evt.total ? (evt.done / evt.total) * 100 : 0}%`;
    clearTimeout(hideTimer);
  } else if (evt.type === 'stage') {
    label.textContent = `${evt.label}: ${evt.stage}`;
    fill.style.width = '95%';
  } else if (evt.type === 'done' || evt.type === 'error') {
    fill.style.width = '100%';
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => bar.classList.add('hidden'), 800);
  }
});
