/**
 * The search in the header (Base.astro, #sitesearch): one box for the whole site, answering as
 * you type with heroes, authors and mods, each a link straight to its page.
 *
 * It reads the file the catalog reads (/catalog/data.json), and only once the box is opened, so a
 * page nobody searches on downloads nothing. A hero is found by the name the game writes, the
 * Russian one and the nicknames players use ("кристалка", "сф"); an author by the name the catalog
 * gives; a mod the way the catalog's own search finds it. Everything put on the page is text and
 * attributes, never HTML: the names come from somebody else's catalog.
 *
 * Ctrl+K (Cmd+K) opens it from anywhere, and so does "/" outside a text field. Up and down move
 * through the answers, Enter follows one, Escape closes.
 */
import { loadCatalog, matcher, rank, el, type Catalog, type Lang } from './catalog';

type Words = {
  heroes: string; authors: string; mods: string; empty: string; all: string;
  modsWord: [string, string, string];
  base: { mods: string; heroes: string; authors: string; catalog: string };
};

type Hit = { href: string; title: string; meta: string; img: string | null };

const MAX = { heroes: 3, authors: 3, mods: 6 };

export function initSiteSearch(dialog: HTMLDialogElement) {
  const lang = (dialog.dataset.lang as Lang) || 'en';
  const w = JSON.parse(dialog.dataset.words!) as Words;
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const list = dialog.querySelector<HTMLElement>('[role="listbox"]')!;
  const nf = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US');
  const pr = new Intl.PluralRules(lang === 'ru' ? 'ru-RU' : 'en-US');
  const modsWord = (n: number) => { const f = pr.select(n); return f === 'one' ? w.modsWord[0] : f === 'few' ? w.modsWord[1] : w.modsWord[2]; };
  const count = (n: number) => `${nf.format(n)} ${modsWord(n)}`;

  let data: Catalog | null = null;
  let heroes: Array<{ slug: string; name: string; hay: string; n: number; img: string | null }> = [];
  let authors: Array<{ slug: string; name: string; hay: string; n: number; img: string | null }> = [];
  const ready = () => loadCatalog(lang).then((c) => {
    if (data) return;
    data = c;
    // newest first, so the first picture found for a hero or an author is their newest
    const by = <K>(key: (m: Catalog['mods'][number]) => K | null) => {
      const out = new Map<K, { n: number; img: string | null }>();
      for (const m of c.mods) {
        const k = key(m);
        if (k === null) continue;
        const e = out.get(k) ?? { n: 0, img: null };
        e.n++;
        e.img ??= m.thumb;
        out.set(k, e);
      }
      return out;
    };
    const heroCount = by((m) => m.hero);
    heroes = c.heroes.map((h) => ({
      slug: h.slug, name: h.name, hay: [h.en, h.ru, ...h.alt].join(' ').toLowerCase(),
      n: heroCount.get(h.slug)?.n ?? 0, img: heroCount.get(h.slug)?.img ?? null,
    })).filter((h) => h.n);
    const authorCount = by((m) => (m.authorPage ? m.authorPage : null));
    const names = new Map(c.mods.filter((m) => m.authorPage).map((m) => [m.authorPage, m.author]));
    authors = [...authorCount].map(([slug, e]) => ({ slug, name: names.get(slug)!, hay: names.get(slug)!.toLowerCase(), n: e.n, img: e.img }));
  });

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
    const q = input.value.trim();
    if (!q || !data) { list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); mark(-1); return; }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const has = (hay: string) => words.every((x) => hay.includes(x));
    const first = (name: string) => (name.toLowerCase().startsWith(words[0]) ? 0 : 1);
    const hh = heroes.filter((h) => has(h.hay)).sort((a, b) => first(a.name) - first(b.name) || b.n - a.n).slice(0, MAX.heroes);
    const aa = authors.filter((a) => has(a.hay)).sort((a, b) => first(a.name) - first(b.name) || b.n - a.n).slice(0, MAX.authors);
    const found = data.mods.filter(matcher(q)).sort((a, b) => rank(b, q) - rank(a, q));
    const groups: Array<[string, Hit[]]> = [
      [w.heroes, hh.map((h) => ({ href: `${w.base.heroes}${h.slug}/`, title: h.name, meta: count(h.n), img: h.img }))],
      [w.authors, aa.map((a) => ({ href: `${w.base.authors}${a.slug}/`, title: a.name, meta: count(a.n), img: a.img }))],
      [w.mods, found.slice(0, MAX.mods).map((m) => ({
        href: `${w.base.mods}${m.key}/`, title: m.name, meta: m.heroName ? `${m.catName} · ${m.heroName}` : m.catName, img: m.thumb,
      }))],
    ];
    const out: HTMLElement[] = [];
    let i = 0;
    for (const [label, hits] of groups) {
      if (!hits.length) continue;
      const g = el('div', 'ss-group');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', label);
      g.append(el('p', 'ss-label', label), ...hits.map((h) => row(h, i++)));
      out.push(g);
    }
    if (found.length > MAX.mods) {
      const all = el('a', 'ss-all', w.all.replace('{n}', nf.format(found.length)));
      all.href = `${w.base.catalog}?q=${encodeURIComponent(q)}`;
      out.push(all);
    }
    if (!out.length) out.push(el('p', 'ss-empty', w.empty));
    list.replaceChildren(...out);
    list.dataset.q = q; // which question the answers on show are for
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
