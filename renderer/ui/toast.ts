/* Transient confirmation. Toasts never carry anything the user has to act on: they
 * remove themselves on a timer, so a message that matters belongs in a dialog.
 *
 * An error toast carries one thing the user may act on: "What do I do?", which opens the part
 * of the troubleshooting guide that fits (ui/error-help.ts, issue #424). The toast waits while
 * the pointer or the keyboard is on it, so the button cannot vanish under the click. A warning
 * may carry one too, when the fix is a single click away (Play's "open Steam downloads").
 *
 * An error toast also offers "Send a report": the diagnostics report saved where the user picks
 * (and shown in its folder), then the Discord server opened, so the file is one drag away from
 * the people who can read it. */
import { $ } from '../core/dom.ts';
import { announce } from './a11y.ts';
import { errorHelpUrl } from './error-help.ts';
import { HELP_LINKS } from '../core/constants.ts';

type ToastKind = 'ok' | 'warn' | 'error';

/** A button on the toast: what it says, and what it does. */
export type ToastAction = { label: string; run: () => void };

export function toast(msg: string, type: ToastKind = 'ok', ms = 4000, action?: ToastAction): void {
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? '' : type}`;
  el.textContent = msg;
  const act = action || (type === 'error'
    ? { label: L`Что делать?`, run: () => { void window.api.misc.openExternal(errorHelpUrl(msg, window.I18N_LANG)); } }
    : null);
  const acts = [act, !action && type === 'error' ? { label: L`Отправить отчёт`, run: () => { void sendReport(); } } : null];
  for (const a of acts) {
    if (!a) continue;
    const help = document.createElement('button');
    help.className = 'toast-help';
    help.type = 'button';
    help.textContent = a.label;
    help.addEventListener('click', a.run);
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

/** The report saved and shown in its folder, then the Discord server opened to drop it in. */
async function sendReport(): Promise<void> {
  const r = await window.api.diag.export();
  if (r?.cancelled) return;
  if (r?.error) { toast(r.error, 'warn', 7000, { label: 'Discord', run: () => { void window.api.misc.openExternal(HELP_LINKS.discord); } }); return; }
  void window.api.misc.openExternal(HELP_LINKS.discord);
  toast(L`Отчёт сохранён и открыт в папке. Перетащи файл в канал поддержки в Discord`, 'ok', 9000);
}
