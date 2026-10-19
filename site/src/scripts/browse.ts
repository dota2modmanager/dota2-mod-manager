/**
 * The catalog's browser, behind Browser.astro: search, sort, the group and category filters, the
 * part filter on a hero's page, the closer look at one mod, and the set that goes to the app.
 *
 * Two modes. "page": every card is already in the HTML (a category, a hero) and this only sorts
 * and hides them. "all": the catalog page, where the first cards are in the HTML and the rest are
 * drawn from /catalog/data.json a screen at a time.
 *
 * The state is in the address (?q=, ?sort=, ?group=, ?cat=, ?slot=, #mod=), so a search can be
 * sent to somebody, Back goes back to it, and the landing's search can land here on a result.
 * Everything put on the page is built with textContent and attributes, never as HTML: the names
 * and authors come from somebody else's catalog.
 */
import { loadCatalog, presetCode, appLink, webLink, fmtDay, isNew, el, type Catalog, type Mod, type Lang } from './catalog';
import { readSet, writeSet, markCards as markIn, SET_KEY } from './set';

type Words = {
  shown: string; more: string; add: string; remove: string; look: string; newBadge: string; by: string;
  kind: string; hero: string; replaces: string; author: string; added: string; style: string;
  openApp: string; copyLink: string; copied: string; noCompress: string; appNote: string; close: string;
  tray: string; setName: string; heroPage: string; kindPage: string; mods: [string, string, string];
  slots: Record<string, string>; heroesLabel: string; heroBase: string; catBase: string; modBase: string; modPage: string; authorBase: string; plainStyle: string;
};

const BATCH = 48;

export function initBrowser(root: HTMLElement) {
  const lang = (root.dataset.lang as Lang) || 'en';
  const mode = root.dataset.mode as 'all' | 'page';
  const context = root.dataset.context as 'all' | 'category' | 'hero' | 'author';
  const w = JSON.parse(root.dataset.words!) as Words;
  const total = Number(root.dataset.total);
  const nf = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US');
  const pr = new Intl.PluralRules(lang === 'ru' ? 'ru-RU' : 'en-US');
  const modsWord = (n: number) => { const f = pr.select(n); return f === 'one' ? w.mods[0] : f === 'few' ? w.mods[1] : w.mods[2]; };

  const grid = root.querySelector<HTMLUListElement>('#browse-grid')!;
  const input = root.querySelector<HTMLInputElement>('#browse-q')!;
  const sortSel = root.querySelector<HTMLSelectElement>('#browse-sort')!;
  const count = root.querySelector<HTMLElement>('#browse-count')!;
  const clear = root.querySelector<HTMLButtonElement>('#browse-clear')!;
  const empty = root.querySelector<HTMLElement>('#browse-empty')!;
  const more = root.querySelector<HTMLButtonElement>('#browse-more')!;
  const groupBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-group-filter]')];
  // inside the toolbar's rows only: the cards carry data-cat too
  const catBtns = [...root.querySelectorAll<HTMLButtonElement>('#browse-cats [data-cat]')];
  const slotBtns = [...root.querySelectorAll<HTMLButtonElement>('#browse-slots [data-slot]')];

  // ---- state, read from the address ----
  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') ?? '',
    sort: ['new', 'old', 'az'].includes(params.get('sort') ?? '') ? params.get('sort')! : 'new',
    group: params.get('group') ?? '',
    cat: params.get('cat') ?? '',
    slot: params.get('slot') ?? '',
  };
  input.value = state.q;
  sortSel.value = state.sort;

  const saveState = () => {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.sort !== 'new') p.set('sort', state.sort);
    if (state.group) p.set('group', state.group);
    if (state.cat) p.set('cat', state.cat);
    if (state.slot) p.set('slot', state.slot);
    const qs = p.toString();
    history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  };

  let catalog: Catalog | null = null;
  const need = () => loadCatalog(lang).then((c) => (catalog = c));

  // ---- the set ----
  let picked = new Set(readSet());
  const markCards = () => markIn(grid, picked, w);
  const toggle = (key: string) => {
    if (picked.has(key)) picked.delete(key); else picked.add(key);
    writeSet([...picked]);
    markCards();
    paintTray();
    if (current === key) paintQuickAdd();
  };

  /** Who made a mod, as a link: to their page here when they have one, else to their profile. */
  const authorLink = (m: Mod): HTMLAnchorElement | null => {
    if (!m.author || (!m.authorPage && !m.authorUrl)) return null;
    const a = el('a', '', m.author);
    if (m.authorPage) a.href = `${w.authorBase}${m.authorPage}/`;
    else { a.href = m.authorUrl; a.rel = 'noopener nofollow'; }
    return a;
  };

  // ---- a card, built the same way ModCard.astro builds one ----
  const card = (m: Mod): HTMLLIElement => {
    const li = el('li', 'mcard');
    li.dataset.group = m.group;
    li.dataset.cat = m.cat;
    li.dataset.key = m.key;
    li.dataset.date = String(m.date);
    li.dataset.name = m.name.toLowerCase();
    li.dataset.hay = m.hay;
    li.dataset.slots = m.slots.join(' ');

    const pic = el('a', 'mcard-pic');
    pic.href = `${w.modBase}${m.key}/`;
    pic.dataset.open = '';
    if (m.thumb) {
      const img = el('img');
      img.src = m.thumb;
      img.srcset = `${m.thumb} 400w, ${m.img} 854w`;
      img.sizes = '(max-width: 520px) 46vw, (max-width: 900px) 30vw, 290px';
      img.width = 400; img.height = 225; img.loading = 'lazy'; img.decoding = 'async';
      img.alt = `${m.name}: ${m.catName}`;
      pic.append(img);
    } else {
      pic.append(el('span', 'none', m.name));
    }
    if (isNew(m)) pic.append(el('span', 'mcard-new', w.newBadge));

    const add = el('button', 'mcard-add');
    add.type = 'button';
    add.dataset.add = '';
    add.setAttribute('aria-pressed', 'false');
    add.setAttribute('aria-label', `${w.add}: ${m.name}`);
    add.innerHTML = '<svg class="no" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><svg class="yes" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7.5"/></svg>';

    const body = el('div', 'mcard-body');
    body.append(el('h2', '', m.name));
    if (m.styles.length) body.append(el('span', 'mcard-style', m.styles.length > 1 ? `${m.style || w.plainStyle} +${m.styles.length - 1}` : m.style));
    const meta = el('div', 'mcard-meta');
    meta.append(el('i', 'dot'), el('span', '', m.heroName ? `${m.catName} · ${m.heroName}` : m.catName));
    body.append(meta);
    if (m.author && context !== 'author') {
      const by = el('div', 'mcard-meta');
      const span = el('span', '', `${w.by} `);
      span.append(authorLink(m) ?? m.author);
      by.append(span);
      body.append(by);
    }
    li.append(pic, add, body);
    return li;
  };

  // ---- filtering and sorting ----
  type Row = { key: string; name: string; date: number; hay: string; slots: string[]; group: string; cat: string; el?: HTMLElement; mod?: Mod };
  let rows: Row[] = [];
  let list: Row[] = [];
  let drawn = 0;

  const fromDom = (): Row[] => [...grid.querySelectorAll<HTMLElement>('.mcard')].map((li) => ({
    key: li.dataset.key!, name: li.dataset.name!, date: Number(li.dataset.date), hay: li.dataset.hay!,
    slots: (li.dataset.slots || '').split(' ').filter(Boolean), group: li.dataset.group!, cat: '', el: li,
  }));
  const fromData = (c: Catalog): Row[] => c.mods.map((m) => ({
    key: m.key, name: m.name.toLowerCase(), date: m.date, hay: m.hay, slots: m.slots, group: m.group, cat: m.cat, mod: m,
  }));

  const apply = () => {
    const words = state.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    list = rows.filter((r) =>
      (!state.group || r.group === state.group) &&
      (!state.cat || r.cat === state.cat) &&
      (!state.slot || r.slots.includes(state.slot)) &&
      words.every((x) => r.hay.includes(x)));
    const by = state.sort;
    list.sort((a, b) => by === 'az' ? a.name.localeCompare(b.name) : by === 'old' ? a.date - b.date || a.name.localeCompare(b.name) : b.date - a.date || a.name.localeCompare(b.name));

    if (mode === 'page') {
      const keep = new Set(list.map((r) => r.key));
      for (const r of rows) r.el!.hidden = !keep.has(r.key);
      grid.append(...list.map((r) => r.el!));
      drawn = list.length;
    } else {
      grid.replaceChildren();
      drawn = 0;
      drawMore();
    }
    paintCount();
  };

  const drawMore = () => {
    const next = list.slice(drawn, drawn + BATCH);
    grid.append(...next.map((r) => card(r.mod!)));
    drawn += next.length;
    more.hidden = drawn >= list.length;
    markCards();
  };

  const paintCount = () => {
    const filtered = !!(state.q || state.group || state.cat || state.slot);
    count.textContent = w.shown.replace('{n}', nf.format(list.length)).replace('{total}', nf.format(rows.length || total));
    clear.hidden = !filtered;
    empty.hidden = list.length > 0;
    for (const b of groupBtns) { const on = b.dataset.groupFilter === state.group && !state.cat; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const b of catBtns) {
      const on = b.dataset.cat === state.cat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      // the kinds on offer are the open group's, or all of them
      b.hidden = !!state.group && b.dataset.group !== state.group;
    }
    for (const b of slotBtns) { const on = (b.dataset.slot || '') === state.slot; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  };

  let timer = 0;
  const changed = () => { saveState(); apply(); };
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => { state.q = input.value; changed(); }, 120); });
  input.form?.addEventListener('submit', (e) => { e.preventDefault(); state.q = input.value; changed(); input.blur(); });
  sortSel.addEventListener('change', () => { state.sort = sortSel.value; changed(); });
  groupBtns.forEach((b) => b.addEventListener('click', () => { state.group = b.dataset.groupFilter || ''; state.cat = ''; changed(); }));
  catBtns.forEach((b) => b.addEventListener('click', () => { state.cat = state.cat === b.dataset.cat ? '' : b.dataset.cat!; if (state.cat) state.group = b.dataset.group || ''; changed(); }));
  slotBtns.forEach((b) => b.addEventListener('click', () => { state.slot = b.dataset.slot || ''; changed(); }));
  clear.addEventListener('click', () => { state.q = ''; state.group = ''; state.cat = ''; state.slot = ''; input.value = ''; changed(); input.focus(); });
  more.addEventListener('click', drawMore);

  // the next screen of cards arrives before the visitor reaches the end of this one
  if (mode === 'all' && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { if (en.isIntersecting && !more.hidden) drawMore(); }, { rootMargin: '900px 0px' }).observe(more);
  }

  grid.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const li = t.closest<HTMLElement>('.mcard');
    if (!li) return;
    if (t.closest('[data-add]')) { toggle(li.dataset.key!); return; }
    const link = t.closest('a');
    if (link && !link.matches('[data-open]')) return; // the author's profile
    // a plain click looks closer; one that asks for a new tab or window gets the mod's page
    if (link && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0)) return;
    e.preventDefault();
    open(li.dataset.key!, li);
  });

  // ---- the closer look ----
  const dialog = document.getElementById('quick') as HTMLDialogElement;
  const qImg = document.getElementById('quick-img') as HTMLImageElement;
  const qTitle = document.getElementById('quick-title')!;
  const qFacts = document.getElementById('quick-facts')!;
  const qApp = document.getElementById('quick-app') as HTMLAnchorElement;
  const qAdd = document.getElementById('quick-add') as HTMLButtonElement;
  const qCopy = document.getElementById('quick-copy') as HTMLButtonElement;
  const qLinks = document.getElementById('quick-links')!;
  let current: string | null = null;
  let opener: HTMLElement | null = null;
  let qCode: string | null = null;

  const paintQuickAdd = () => {
    const on = !!current && picked.has(current);
    (qAdd.querySelector('span') as HTMLElement).textContent = on ? w.remove : w.add;
    qAdd.classList.toggle('on', on);
  };

  async function open(key: string, from?: HTMLElement) {
    if (!catalog) { try { await need(); } catch { return; } }
    const m = catalog!.byKey.get(key);
    if (!m) return;
    current = key;
    opener = from ?? null;
    qImg.src = m.img ?? ''; qImg.hidden = !m.img;
    qImg.alt = `${m.name}: ${m.catName}`;
    qTitle.textContent = m.name;
    const facts: Array<[string, string | Node]> = [[w.kind, m.catName]];
    if (m.heroName) facts.push([w.hero, m.heroName]);
    if (m.styles.length) facts.push([w.style, m.styles.map((s) => s || w.plainStyle).join(', ')]);
    if (m.slots.length) facts.push([w.replaces, m.slots.map((s) => w.slots[s] ?? s).join(', ')]);
    if (m.author) {
      facts.push([w.author, authorLink(m) ?? m.author]);
    }
    if (m.date) facts.push([w.added, fmtDay(lang, m.date)]);
    qFacts.replaceChildren(...facts.flatMap(([k, v]) => { const dd = el('dd'); dd.append(v); return [el('dt', '', k), dd]; }));
    qLinks.replaceChildren();
    const linkTo = (href: string, text: string) => { const a = el('a', '', text); a.href = href; return a; };
    const links: HTMLAnchorElement[] = [linkTo(`${w.modBase}${m.key}/`, w.modPage)];
    if (m.hero && context !== 'hero') links.push(linkTo(`${w.heroBase}${m.hero}/`, w.heroPage.replace('{hero}', m.heroName ?? '')));
    if (m.cat !== 'heroes' && context !== 'category') links.push(linkTo(`${w.catBase}${m.cat}/`, w.kindPage.replace('{kind}', m.catName)));
    links.forEach((a, i) => { if (i) qLinks.append(' · '); qLinks.append(a); });
    paintQuickAdd();
    qCode = null;
    qApp.href = '#';
    presetCode(m.name, [m]).then((code) => { if (current === key && code) { qCode = code; qApp.href = appLink(code); } });
    if (!dialog.open) dialog.showModal();
    if (location.hash !== `#mod=${encodeURIComponent(key)}`) history.replaceState(history.state, '', `${location.pathname}${location.search}#mod=${encodeURIComponent(key)}`);
  }

  const close = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener('close', () => {
    current = null;
    if (location.hash.startsWith('#mod=')) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    opener?.querySelector<HTMLElement>('[data-open]')?.focus();
  });
  document.getElementById('quick-close')!.addEventListener('click', close);
  // a press on the dimmed page around the box closes it, as it does in the app
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  qAdd.addEventListener('click', () => { if (current) toggle(current); });
  // the mod's own page: it shows the mod to anybody, with its picture in a chat's preview
  qCopy.addEventListener('click', () => { if (current) copy(`${location.origin}${w.modBase}${current}/`); });
  qApp.addEventListener('click', (e) => { if (!qCode) { e.preventDefault(); say(w.noCompress); } });

  // ---- the tray ----
  const tray = document.getElementById('tray')!;
  const trayCount = document.getElementById('tray-count')!;
  const trayApp = document.getElementById('tray-app') as HTMLAnchorElement;
  let trayCode: string | null = null;
  let trayRun = 0;
  async function paintTray() {
    const n = picked.size;
    tray.hidden = n === 0;
    trayCount.textContent = w.tray.replace('{n}', nf.format(n)).replace('{word}', modsWord(n));
    trayCode = null;
    trayApp.href = '#';
    if (!n) return;
    const run = ++trayRun;
    if (!catalog) { try { await need(); } catch { return; } }
    const mods = [...picked].map((k) => catalog!.byKey.get(k)).filter(Boolean) as Mod[];
    const code = await presetCode(w.setName, mods);
    if (run !== trayRun) return;
    trayCode = code;
    if (code) trayApp.href = appLink(code);
  }
  trayApp.addEventListener('click', (e) => { if (!trayCode) { e.preventDefault(); say(w.noCompress); } });
  document.getElementById('tray-copy')!.addEventListener('click', () => { if (trayCode) copy(webLink(trayCode)); else say(w.noCompress); });
  document.getElementById('tray-clear')!.addEventListener('click', () => { picked = new Set(); writeSet([]); markCards(); paintTray(); });
  // another tab changed the set
  window.addEventListener('storage', (e) => { if (e.key === SET_KEY) { picked = new Set(readSet()); markCards(); paintTray(); } });

  // ---- saying something, briefly ----
  let toastTimer = 0;
  function say(text: string) {
    document.querySelector('.toast')?.remove();
    const t = el('div', 'toast', text);
    t.setAttribute('role', 'status');
    (dialog.open ? dialog : document.body).append(t);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.remove(), 2600);
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); say(w.copied); } catch { say(text); }
  }

  // ---- start ----
  if (mode === 'page') {
    rows = fromDom();
    list = rows;
    if (state.q || state.slot || state.sort !== 'new') apply(); else paintCount();
    markCards();
  } else {
    // the first cards are already on the page; the rest arrive with the data
    rows = fromDom();
    list = rows;
    markCards();
    paintCount();
    need().then((c) => {
      rows = fromData(c);
      apply();
    }).catch(() => { more.hidden = true; });
  }
  paintTray();
  const fromHash = decodeURIComponent(location.hash.match(/^#mod=(.+)$/)?.[1] ?? '');
  if (fromHash) open(fromHash);
  window.addEventListener('hashchange', () => {
    const k = decodeURIComponent(location.hash.match(/^#mod=(.+)$/)?.[1] ?? '');
    if (k && k !== current) open(k);
  });
}

