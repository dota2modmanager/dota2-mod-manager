/* Transient confirmation. Toasts never carry anything the user has to act on: they
 * remove themselves on a timer, so a message that matters belongs in a dialog.
 *
 * An error toast carries one thing the user may act on: "What do I do?", which opens the part
 * of the troubleshooting guide that fits (ui/error-help.ts, issue #424). The toast waits while
 * the pointer or the keyboard is on it, so the button cannot vanish under the click. */
import { $ } from '../core/dom.ts';
import { announce } from './a11y.ts';
import { errorHelpUrl } from './error-help.ts';

type ToastKind = 'ok' | 'warn' | 'error';

export function toast(msg: string, type: ToastKind = 'ok', ms = 4000): void {
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? '' : type}`;
  el.textContent = msg;
  if (type === 'error') {
    const help = document.createElement('button');
    help.className = 'toast-help';
    help.type = 'button';
    help.textContent = L`Что делать?`;
    help.addEventListener('click', () => { void window.api.misc.openExternal(errorHelpUrl(msg, window.I18N_LANG)); });
    el.appendChild(help);
  }
  $('#toasts').appendChild(el);
  announce(msg);
  let timer = setTimeout(() => el.remove(), ms);
  const hold = () => clearTimeout(timer);
  const release = () => { clearTimeout(timer); timer = setTimeout(() => el.remove(), ms); };
  el.addEventListener('pointerenter', hold);
  el.addEventListener('pointerleave', release);
  el.addEventListener('focusin', hold);
  el.addEventListener('focusout', release);
}
