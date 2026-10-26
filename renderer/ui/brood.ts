/* Broodmother's children (ui/spiders.ts runs them).
 *
 * Wherever Broodmother turns up in the window, spiders pour out of her: a click on her tile or on
 * one of her mods, opening her mods, or typing her name into the search. They burst out of the
 * thing that was clicked or typed into, scatter from the pointer and, after a while, leave.
 *
 * It is also the way to the pumpkin's light: a spider caught and thrown into the pumpkin is the
 * only thing that warms it (ui/pumpkin.ts). So this is in every theme, all year round, and costs
 * nothing until somebody says her name.
 */
import { spawnSpider } from './spiders.ts';

/** Her name in the three languages the window speaks, and the short forms people type. */
const HER = /brood|бруд|паучих|育母/i;

let lastBurst = 0;

/** Spiders out of the element's middle, in every direction. */
export function broodFrom(el: Element, count = 14): void {
  const now = performance.now();
  if (now - lastBurst < 1200) return;      // one burst per gesture, not one per keystroke
  lastBurst = now;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 60);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    setTimeout(() => spawnSpider(x + Math.cos(a) * 8, y + Math.sin(a) * 8, { burst: 380 + Math.random() * 420, angle: a, life: 7 + Math.random() * 8 }), i * 35);
  }
}

/** What an element says about itself: its hero, its catalog key, or its first words. */
function says(el: HTMLElement): string {
  return `${el.dataset.hero ?? ''} ${el.dataset.key ?? ''} ${el.dataset.name ?? ''} ${(el.textContent ?? '').slice(0, 160)}`;
}

export function initBrood(): void {
  // a click on her tile, her card, her row: the nearest thing that names a hero or a mod
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const el = target?.closest<HTMLElement>('[data-hero], [data-key], [role="option"], .hero-tile, .mod-card, .lib-row, .card');
    if (el && HER.test(says(el))) broodFrom(el);
  }, true);
  // her name typed into any search
  let was = false;
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.tagName !== 'INPUT') return;
    const is = HER.test(el.value);
    if (is && !was) broodFrom(el, 10);
    was = is;
  }, true);
  // a hero picked from a list (the hero filter): her name in the chosen option
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement | null;
    if (el?.tagName === 'SELECT' && HER.test(el.selectedOptions?.[0]?.textContent ?? el.value)) broodFrom(el);
  }, true);
}
