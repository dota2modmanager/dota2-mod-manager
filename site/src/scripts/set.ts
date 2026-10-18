/**
 * The set a visitor collects, kept in their own browser and shared by every page that lists mods:
 * the catalog's browser (browse.ts), whose tray turns it into a preset link, and a mod's own page
 * (mod-page.ts). Keys are the catalog's (src/lib/catalog.ts), the same as a mod page's address.
 */
export const SET_KEY = 'mm-set';

export const readSet = (): string[] => {
  try { return JSON.parse(localStorage.getItem(SET_KEY) || '[]').filter((k: unknown) => typeof k === 'string'); } catch { return []; }
};

export const writeSet = (keys: string[]) => {
  try { localStorage.setItem(SET_KEY, JSON.stringify(keys)); } catch { /* private mode: this page only */ }
};

/** Mark the cards in `root` that are in the set, on the card and on its button. */
export function markCards(root: ParentNode, picked: Set<string>, words: { add: string; remove: string }) {
  for (const li of root.querySelectorAll<HTMLElement>('.mcard')) {
    const on = picked.has(li.dataset.key!);
    li.classList.toggle('picked', on);
    const btn = li.querySelector<HTMLButtonElement>('[data-add]');
    if (btn) {
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${on ? words.remove : words.add}: ${li.querySelector('h2, h3')?.textContent ?? ''}`);
    }
  }
}
