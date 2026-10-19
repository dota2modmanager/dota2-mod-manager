/**
 * The search in the header (Base.astro, #sitesearch): one box for the whole site, answering as
 * you type with heroes, authors and mods, each a link straight to its page.
 *
 * What a question finds is search-engine.ts, which the landing's finder asks too; this is the box
 * and how it answers. It reads /catalog/data.json only once it is opened, so a page nobody searches
 * on downloads nothing. Everything put on the page is text and attributes, never HTML: the names
 * come from somebody else's catalog.
 *
 * Ctrl+K (Cmd+K) opens it from anywhere, and so does "/" outside a text field. Up and down move
 * through the answers, Enter follows one, Escape closes.
 */
import { el, type Lang } from './catalog';
import { searchEngine, type Hit, type Words } from './search-engine';

export function initSiteSearch(dialog: HTMLDialogElement) {
  const lang = (dialog.dataset.lang as Lang) || 'en';
  const w = JSON.parse(dialog.dataset.words!) as Words;
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const list = dialog.querySelector<HTMLElement>('[role="listbox"]')!;
  const { ready, answer } = searchEngine(lang, w);

  // ---- answering ----
  let active = -1;
  const options = () => [...list.querySelectorAll<HTMLAnchorElement>('[role="option"]')];
  const mark = (i: number) => {
    const all = options();
    active = all.length ? (i + all.length) % all.length : -1;
    all.forEach((o, j) => o.setAttribute('aria-selected', String(j === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', all[active].id); all[active].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };

  const row = (h: Hit, i: number) => {
    const a = el('a', 'ss-row');
    a.href = h.href;
    a.id = `ss-${i}`;
    a.setAttribute('role', 'option');
    a.setAttribute('aria-selected', 'false');
    if (h.img) { const img = el('img'); img.src = h.img; img.alt = ''; img.width = 400; img.height = 225; img.decoding = 'async'; a.append(img); }
    else a.append(el('span', 'ss-none'));
    const text = el('span', 'ss-text');
    text.append(el('b', '', h.title), el('span', '', h.meta));
    a.append(text);
    return a;
  };

  const render = () => {
    const ans = answer(input.value);
    if (!ans) { list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); mark(-1); return; }
    const out: HTMLElement[] = [];
    let i = 0;
    for (const g of ans.groups) {
      const box = el('div', 'ss-group');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', g.label);
      box.append(el('p', 'ss-label', g.label), ...g.hits.map((h) => row(h, i++)));
      out.push(box);
    }
    const shownMods = ans.groups.find((g) => g.kind === 'mod')?.hits.length ?? 0;
    if (ans.found > shownMods) {
      const all = el('a', 'ss-all', ans.all.label);
      all.href = ans.all.href;
      out.push(all);
    }
    if (!out.length) out.push(el('p', 'ss-empty', w.empty));
    list.replaceChildren(...out);
    list.dataset.q = ans.q; // which question the answers on show are for
    input.setAttribute('aria-expanded', String(i > 0));
    mark(i ? 0 : -1);
  };

  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => { ready().then(render).catch(() => {}); }, 80); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const go = options()[active] ?? list.querySelector<HTMLAnchorElement>('a');
      if (go) location.href = go.href;
    }
  });
  list.addEventListener('mousemove', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLAnchorElement>('[role="option"]');
    if (o) mark(options().indexOf(o));
  });

  // ---- opening and closing ----
  const open = () => {
    // from the phone's menu: the sheet folds away behind the box rather than waiting under it
    if (document.getElementById('menu')?.hidden === false) document.querySelector<HTMLButtonElement>('.menu-btn')?.click();
    if (!dialog.open) dialog.showModal();
    input.focus();
    input.select();
    ready().then(render).catch(() => {});
  };
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-search-open]')) { e.preventDefault(); open(); }
  });
  dialog.querySelector('[data-search-close]')?.addEventListener('click', () => dialog.close());
  // a press on the dimmed page around the box closes it
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(); }
  });
}
