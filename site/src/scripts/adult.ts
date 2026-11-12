/**
 * The one question before the catalog lists its 18+ mods (explicit hero models).
 *
 * No page of the site shows them (src/lib/heroes.ts). The catalog's browser lists them once the
 * visitor presses "18+" and says they are 18 and want them, the way the app asks
 * (renderer/core/adult.ts). The answer stays in this browser only, so the question is not asked
 * again; pressing "18+" once more hides them again without asking. Unanswered is no.
 */
const KEY = 'mm-adult';

/** Whether this visitor said they are 18 and want the 18+ mods listed. */
export function adultShown(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setAdultShown(on: boolean) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private window: this page only */ }
}

/**
 * Ask, in the dialog Browser.astro carries. Resolves true for "I am 18, show them", false for
 * anything else: the other button, Escape, a press outside. "Do not show" holds the focus, so a
 * stray Enter keeps them hidden.
 */
export function askAdult(dialog: HTMLDialogElement): Promise<boolean> {
  return new Promise((done) => {
    const yes = dialog.querySelector<HTMLButtonElement>('[data-adult-yes]')!;
    const no = dialog.querySelector<HTMLButtonElement>('[data-adult-no]')!;
    let answer = false;
    const finish = () => {
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      dialog.removeEventListener('click', onOutside);
      done(answer);
    };
    const onYes = () => { answer = true; dialog.close(); };
    const onNo = () => dialog.close();
    const onOutside = (e: MouseEvent) => { if (e.target === dialog) dialog.close(); };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    dialog.addEventListener('click', onOutside);
    dialog.addEventListener('close', finish, { once: true });
    dialog.showModal();
    no.focus();
  });
}
