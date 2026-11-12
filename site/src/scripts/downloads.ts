/**
 * How many times each mod was downloaded, on its card and on its page.
 *
 * The numbers come from the catalog's own counter (the D2PFX Worker), the same one the app reads
 * and counts installs into (src/download-stats.ts in the app). Each card carries the counter's key
 * for its mod (data-count, category/group/name); this asks the counter once per page, keeps the
 * answer for five minutes in sessionStorage so walking through pages does not ask again, and adds
 * the number to every card that has one.
 *
 * A mod with looks is counted per look: the catalog's site sends category/group/name/Look, and the
 * plain key gets only the app's hits, which it also sends per look. So a mod's number is the sum of
 * its looks, or its own key where that is more (a mod with one look has only that).
 *
 * A missing number is never shown as zero. Until the counter answers, when it cannot be reached,
 * and for a mod nobody has downloaded yet, the card is what it was before.
 */
const API = 'https://d2pfx-counter.hrdqfck.workers.dev/downloads.json';
const CACHE = 'mm-downloads';
const TTL = 5 * 60 * 1000;

type Counts = Record<string, number>;
let pending: Promise<Counts | null> | null = null;

function cached(): Counts | null {
  try {
    const raw = sessionStorage.getItem(CACHE);
    if (!raw) return null;
    const { at, counts } = JSON.parse(raw);
    return Date.now() - at < TTL && counts && typeof counts === 'object' ? counts : null;
  } catch {
    return null;
  }
}

/** The counts, asked for once per page; null when the counter could not say. */
export function loadCounts(): Promise<Counts | null> {
  pending ||= (async () => {
    const have = cached();
    if (have) return have;
    try {
      const res = await fetch(API, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const counts = await res.json();
      if (!counts || typeof counts !== 'object') return null;
      try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), counts })); } catch { /* private mode */ }
      return counts as Counts;
    } catch {
      return null;
    }
  })();
  return pending;
}

const totals = new WeakMap<Counts, Map<string, number>>();

/** How many times the mod with this key was downloaded, all its looks together; 0 when unknown. */
export function downloadsOf(counts: Counts | null, key: string): number {
  if (!counts || !key) return 0;
  let looks = totals.get(counts);
  if (!looks) {
    looks = new Map();
    for (const [k, n] of Object.entries(counts)) {
      if (typeof n !== 'number') continue;
      const at = k.lastIndexOf('/');
      if (at > 0) looks.set(k.slice(0, at), (looks.get(k.slice(0, at)) ?? 0) + n);
    }
    totals.set(counts, looks);
  }
  return Math.max(Number(counts[key]) || 0, looks.get(key) ?? 0);
}

/** 950 → "950", 1234 → "1.2k", 15600 → "15k", 2 500 000 → "2.5M", as the app writes it. */
export function formatCount(n: number): string {
  if (n < 1e3) return String(n);
  if (n < 1e4) return `${Math.floor(n / 100) / 10}k`;
  if (n < 1e6) return `${Math.floor(n / 1e3)}k`;
  if (n < 1e7) return `${Math.floor(n / 1e5) / 10}M`;
  return `${Math.floor(n / 1e6)}M`;
}

const label = () => (document.documentElement.lang === 'ru' ? 'Скачиваний' : 'Downloads');
const ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

/** Puts the number on every card under `root` that has one and does not show it yet. */
export function paintCards(root: ParentNode, counts: Counts | null): void {
  if (!counts) return;
  for (const card of root.querySelectorAll<HTMLElement>('.mcard[data-count]')) {
    const n = downloadsOf(counts, card.dataset.count!);
    if (!n || card.querySelector('.mcard-dl')) continue;
    const meta = card.querySelector('.mcard-meta');
    if (!meta) continue;
    const chip = document.createElement('span');
    chip.className = 'mcard-dl';
    chip.title = `${label()}: ${n.toLocaleString(document.documentElement.lang || 'en')}`;
    chip.innerHTML = ICON;
    const num = document.createElement('b');
    num.textContent = formatCount(n);
    const said = document.createElement('span');
    said.className = 'sr-only';
    said.textContent = ` ${label().toLowerCase()}`;
    chip.append(num, said);
    meta.append(chip);
  }
}

/** Asks for the counts and paints `root` when they come; for a grid drawn again, call paintCards. */
export function showCounts(root: ParentNode): Promise<Counts | null> {
  return loadCounts().then((c) => { paintCards(root, c); return c; });
}
