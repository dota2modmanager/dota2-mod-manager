/* Where to go when the app has no answer.
 *
 * Two places, and neither is ours: the catalog's wiki and its Discord. The addresses come
 * from the catalog itself - it publishes both under "news" - so a moved invite follows
 * without a release, and the constants only stand in on a first run with no catalog yet.
 *
 * The wiki is written in both languages, so the link carries the one the user is already
 * reading in rather than dropping an English page on a Russian window.
 */
import { $ } from '../core/dom.ts';
import { state } from '../core/store.ts';
import { HELP_LINKS } from '../core/constants.ts';

function newsUrl(re: RegExp): string | undefined {
  const news = state.catalog?.mods?.modsData?.news;
  return (Array.isArray(news) ? news : [])
    .map((n) => n.url)
    .find((u): u is string => typeof u === 'string' && re.test(u));
}

function wikiUrl(): string {
  const base = newsUrl(/wiki/i) || HELP_LINKS.wiki;
  try {
    const u = new URL(base);
    // only a bare address gets a language: a deeper link the catalog gives is already a page
    if (u.pathname !== '/') return base;
    return new URL(window.I18N_LANG === 'ru' ? 'ru/' : 'en/', u).href;
  } catch {
    return base;
  }
}

const discordUrl = () => newsUrl(/discord\.(gg|com)/i) || HELP_LINKS.discord;

// Ours, and the only place in the window that says the app has a home of its own. The site
// carries the answers this menu cannot: what the program is, and every release with its notes.
const SITE = 'https://dota2modmanager.com/';
const siteUrl = () => (window.I18N_LANG === 'ru' ? `${SITE}ru/` : SITE);

export function bindHelp(): void {
  const btn = $('#helpBtn');
  const menu = $('#helpMenu');
  if (!btn || !menu) return;

  const close = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    // built on opening, not on boot: the catalog arrives later and the language can change.
    // Each item carries the address it will open, so where it goes can be read off the item
    // rather than found out by pressing it.
    menu.innerHTML = `
      <button class="tb-menu-item" data-url="${wikiUrl()}" role="menuitem">
        <span class="ms">menu_book</span>
        <span>${L`Вики`}</span>
        <span class="ms tb-menu-out">open_in_new</span>
      </button>
      <button class="tb-menu-item" data-url="${discordUrl()}" role="menuitem">
        <span class="ms">forum</span>
        <span>Discord</span>
        <span class="ms tb-menu-out">open_in_new</span>
      </button>
      <button class="tb-menu-item" data-url="${siteUrl()}" role="menuitem">
        <span class="ms">public</span>
        <span>${L`Сайт программы`}</span>
        <span class="ms tb-menu-out">open_in_new</span>
      </button>`;
    menu.querySelectorAll<HTMLElement>('[data-url]').forEach((item) => {
      item.addEventListener('click', () => {
        window.api.misc.openExternal(item.dataset.url || '');
        close();
      });
    });
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) open();
    else close();
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  // A menu hangs off the button that opened it. Scroll the page and the button goes with the
  // titlebar while the menu stays where it was, sitting over the mods and then under them.
  // A dropdown that outlives the gesture that opened it is a dropdown in the wrong place.
  document.addEventListener('scroll', () => {
    if (!menu.classList.contains('hidden')) close();
  }, { capture: true, passive: true });
}
