/* The window asking people to support the project: a star on GitHub first, because it is one
 * click, then a word about us somewhere, and why each one matters to us.
 *
 * It opens on its own from the third launch (src/support-prompt.ts decides when) and from
 * Settings at any time. On its own, its two closing buttons wait a few seconds before they
 * work: long enough for the eye to land on the text, short enough not to feel like a penalty.
 * Either action counts as an answer, so somebody who starred the project is not asked again.
 */
import { toast } from './toast.ts';

const REPO = 'https://github.com/dota2modmanager/dota2-mod-manager';
const SITE = 'https://dota2modmanager.com';
/** how long the closing buttons wait when the window opened on its own (tokens.css --dur-wait) */
const WAIT_MS = 3000;

const part = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

function supportDialog({ auto }: { auto: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box support-box" role="dialog" aria-modal="true" aria-labelledby="supportDlgTitle">
        <div class="tool-head">
          <span class="ms">favorite</span>
          <div>
            <div class="tool-title" id="supportDlgTitle">${L`Нравится Mod Manager?`}</div>
            <div class="tool-sub">${L`Две просьбы. Обе бесплатные и занимают минуту.`}</div>
          </div>
        </div>
        <ol class="support-steps">
          <li class="support-step">
            <div class="support-step-title">${L`Поставь звезду на GitHub`}</div>
            <button class="btn btn-primary" data-c="star"><span class="ms">star</span>${L`Поставить звезду`}</button>
            <p>${L`Звёзды видят разработчики. По ним они находят проект и приходят добавлять функции, чинить ошибки и улучшать приложение.`}</p>
          </li>
          <li class="support-step">
            <div class="support-step-title">${L`Расскажи о нас`}</div>
            <button class="btn" data-c="copy"><span class="ms">link</span>${L`Скопировать ссылку`}</button>
            <p>${L`Пост на Reddit, сообщение в Discord, комментарий под видео про моды. Это помогает получить бесплатную подпись программы от SignPath: без неё Windows пугает «неизвестным издателем». Прошлую заявку отклонили, потому что о проекте мало кто знает.`}</p>
          </li>
        </ol>
        <div class="confirm-actions">
          ${auto
            ? `<button class="btn support-wait" data-c="later" disabled>${L`Напомнить позже`}</button>
               <button class="btn support-wait" data-c="done" disabled>${L`Уже сделано`}</button>`
            : `<button class="btn" data-c="close">${L`Закрыть`}</button>`}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    let open = !auto;
    let answered = false;
    // one answer per window: an action clicked first is the answer, whatever closes it after
    const answer = (choice: 'later' | 'done') => {
      if (!auto || answered) return;
      answered = true;
      window.api.support.choose(choice);
    };
    const done = (choice: 'later' | 'done') => {
      answer(choice);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      open = true;
      overlay.querySelectorAll<HTMLButtonElement>('.support-wait').forEach((b) => { b.disabled = false; });
    }, auto ? WAIT_MS : 0);

    part(overlay, '[data-c="star"]').addEventListener('click', () => {
      answer('done');
      window.api.misc.openExternal(REPO);
    });
    part(overlay, '[data-c="copy"]').addEventListener('click', () => {
      answer('done');
      navigator.clipboard.writeText(SITE).then(() => toast(L`Ссылка скопирована`), () => toast(SITE));
    });
    overlay.querySelector('[data-c="later"]')?.addEventListener('click', () => done('later'));
    overlay.querySelector('[data-c="done"]')?.addEventListener('click', () => done('done'));
    overlay.querySelector('[data-c="close"]')?.addEventListener('click', () => done('later'));
    // outside and Escape close it only once the buttons would, and then mean "later"
    overlay.addEventListener('click', (e) => { if (e.target === overlay && open) done('later'); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) done('later'); };
    document.addEventListener('keydown', onKey);
    part(overlay, '[data-c="star"]').focus();
  });
}

/** Open it from Settings: no wait, nothing remembered. */
export const showSupport = (): Promise<void> => supportDialog({ auto: false });

/** Open it at start if it is due. Asked every start, because asking is what counts the launch;
 * `quiet` is a start that already showed a window of its own (what's new), and two in a row
 * read as spam, so this one waits for the next start. */
export async function offerSupport({ quiet = false } = {}): Promise<void> {
  let r: { due: boolean } | null = null;
  try { r = await window.api.support.state(); } catch { return; }
  if (r?.due && !quiet) await supportDialog({ auto: true });
}
