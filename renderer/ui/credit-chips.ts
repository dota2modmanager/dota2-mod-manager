/* The people a mod credits, as chips in the mod window. core/credits.ts decides who they are;
 * this draws them and makes the ones with a page open it.
 *
 * The icons are the catalog's own (LINK_ICONS in its constants), so a person reads the same here
 * as on the site. An author is the default and needs no word; a modder or a sender says what
 * they did, quieter than their name, so the author still leads.
 */
import { esc } from './format.ts';
import type { Credit, CreditRole } from '../core/credits.ts';

const ICON: Record<CreditRole, string> = { author: 'person', modded: 'construction', sender: 'send' };

export function creditChipsHtml(credits: Credit[]): string {
  return credits.map((c, i) => {
    const role = c.role === 'modded' ? L`моддер` : c.role === 'sender' ? L`отправитель` : '';
    const title = c.role === 'modded' ? L`Моддер: ${c.name}` : c.role === 'sender' ? L`Отправитель: ${c.name}` : L`Автор: ${c.name}`;
    return `<button class="author-chip ${c.href ? 'clickable' : ''}" data-credit="${i}" ${c.href ? '' : 'disabled'} title="${esc(title)}" aria-label="${esc(title)}">`
      + `<span class="ms">${ICON[c.role] || 'person'}</span>`
      + (role ? `<span class="credit-role">${esc(role)}</span>` : '')
      + `${esc(c.name)}${c.href ? '<span class="ms ms-xs">open_in_new</span>' : ''}</button>`;
  }).join('');
}

export function bindCreditChips(root: ParentNode, credits: Credit[], open: (url: string) => void): void {
  credits.forEach((c, i) => {
    const chip = root.querySelector(`[data-credit="${i}"]`);
    const href = c.href;
    if (chip && href) chip.addEventListener('click', () => open(href));
  });
}
