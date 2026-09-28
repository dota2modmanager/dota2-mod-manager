/* Transient confirmation. Toasts never carry anything the user has to act on: they
 * remove themselves on a timer, so a message that matters belongs in a dialog. */
import { $ } from '../core/dom.ts';

export function toast(msg, type = 'ok', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? '' : type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
