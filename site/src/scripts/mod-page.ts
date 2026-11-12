/**
 * A mod's own page (components/ModPage.astro): switching between the mod's styles, putting it in
 * the set, and sending the link on.
 *
 * A style button carries its picture and its own preset link, worked out at build time, so a
 * switch changes what the page shows and what "Open in Mod Manager" opens together. The set is
 * the one the catalog keeps (set.ts); the cards under the mod use it too.
 */
import { readSet, writeSet, markCards, SET_KEY } from './set';
import { loadCounts, paintCards, downloadsOf } from './downloads';

type Words = { add: string; remove: string; shared: string; inSet: string; mods: [string, string, string] };

export function initModPage(root: HTMLElement) {
  const w = JSON.parse(root.dataset.words!) as Words;
  const key = root.dataset.key!;
  const lang = document.documentElement.lang === 'ru' ? 'ru-RU' : 'en-US';
  const nf = new Intl.NumberFormat(lang);
  const pr = new Intl.PluralRules(lang);
  const modsWord = (n: number) => { const f = pr.select(n); return f === 'one' ? w.mods[0] : f === 'few' ? w.mods[1] : w.mods[2]; };

  // ---- how many times it was downloaded, here and on the cards below ----
  void loadCounts().then((counts) => {
    const dd = document.getElementById('mod-dl');
    const n = dd ? downloadsOf(counts, dd.dataset.count!) : 0;
    if (dd && n) {
      dd.textContent = nf.format(n);
      dd.hidden = false;
      document.getElementById('mod-dl-label')!.hidden = false;
    }
    paintCards(document, counts); // the cards under it sit outside the article
  });

  // ---- styles ----
  const img = document.getElementById('mod-img') as HTMLImageElement | null;
  const app = document.getElementById('mod-app') as HTMLAnchorElement;
  const looks = [...root.querySelectorAll<HTMLButtonElement>('.mod-look')];
  for (const btn of looks) {
    btn.addEventListener('click', () => {
      for (const b of looks) b.setAttribute('aria-pressed', String(b === btn));
      if (img) {
        img.srcset = `${btn.dataset.thumb} 400w, ${btn.dataset.img} 854w`;
        img.src = btn.dataset.img!;
        img.alt = btn.dataset.alt!;
      }
      app.href = btn.dataset.app!;
    });
  }

  // ---- the set ----
  const add = document.getElementById('mod-add') as HTMLButtonElement;
  const line = document.getElementById('mod-set')!;
  const more = document.querySelector<HTMLElement>('.mod-more');
  let picked = new Set(readSet());
  const paint = () => {
    const on = picked.has(key);
    add.setAttribute('aria-pressed', String(on));
    add.classList.toggle('on', on);
    add.querySelector('span')!.textContent = on ? w.remove : w.add;
    line.hidden = picked.size === 0;
    line.querySelector('span')!.textContent = w.inSet.replace('{n}', nf.format(picked.size)).replace('{word}', modsWord(picked.size));
    if (more) markCards(more, picked, w);
  };
  const toggle = (k: string) => {
    if (picked.has(k)) picked.delete(k); else picked.add(k);
    writeSet([...picked]);
    paint();
  };
  add.addEventListener('click', () => toggle(key));
  // the cards under the mod: their button keeps the set, and the rest of the card is its page
  more?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const li = t.closest<HTMLElement>('.mcard');
    if (!li) return;
    if (t.closest('[data-add]')) { toggle(li.dataset.key!); return; }
    if (t.closest('a')) return;
    location.href = li.querySelector<HTMLAnchorElement>('[data-open]')!.href;
  });
  // another tab changed the set
  window.addEventListener('storage', (e) => { if (e.key === SET_KEY) { picked = new Set(readSet()); paint(); } });
  paint();

  // ---- the link ----
  // A phone's own share sheet is how somebody sends a link from one; a computer copies it.
  const share = document.getElementById('mod-share') as HTMLButtonElement;
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  share.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}`;
    try {
      if (touch && navigator.share) { await navigator.share({ title: document.title, url }); return; }
      await navigator.clipboard.writeText(url);
      say(w.shared);
    } catch { /* the share sheet was closed, or the clipboard refused: nothing to undo */ }
  });

  let timer = 0;
  function say(text: string) {
    document.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.append(t);
    clearTimeout(timer);
    timer = window.setTimeout(() => t.remove(), 2600);
  }
}
