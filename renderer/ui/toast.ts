/* Transient confirmation. Toasts never carry anything the user has to act on: they
 * remove themselves on a timer, so a message that matters belongs in a dialog. */
import { $ } from '../core/dom.ts';

type ToastKind = 'ok' | 'warn' | 'error';

export function toast(msg: string, type: ToastKind = 'ok', ms = 4000): void {
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? '' : type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
