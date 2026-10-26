/**
 * The end of the night, on the page for an address that is not here (pages/404.astro).
 *
 * The app's pumpkin, once opened, says where to go next: where there is nothing on the site, find
 * his mask. It hangs there on a thread while Halloween is in season. Pressed, it screams, and then
 * shows what it was hiding: the mod the pumpkin gives, what went into it and where it is kept.
 * Whoever got that far keeps the mask in the footer of every page (scripts/dread.ts, mm-heart).
 */
import { lookNow } from './look';
import { stinger } from './spook-sound';
import { trophy } from './dread';

const WORDS = {
  en: {
    label: 'A mask on a thread',
    title: 'Necrophos: Scream',
    body: [
      'A set for Necrophos made from nothing: a mask and hood of its own, a black robe, a bloody scythe, every effect of his turned red, new spell icons, and the look and sound of his immortals without owning them.',
      'It is not in the catalog. It is hidden in the night that runs between the site and the app: the eight on the site, the pumpkin in the app, and a key of your own that opens it once.',
    ],
    close: 'Close',
  },
  ru: {
    label: 'Маска на нитке',
    title: 'Некрофос: Крик',
    body: [
      'Сет для Некрофоса, сделанный с нуля: своя маска и капюшон, чёрная мантия, окровавленная коса, все его эффекты в красном, новые иконки способностей, а ещё вид и звуки его имморталов без самих предметов.',
      'В каталоге его нет. Он спрятан в ночи, которая идёт между сайтом и приложением: восемь героев на сайте, тыква в приложении и твой собственный ключ, который откроет его один раз.',
    ],
    close: 'Закрыть',
  },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** The scream, and then the mod it was hiding. */
function reveal(ru: boolean, from: HTMLElement): void {
  const w = WORDS[ru ? 'ru' : 'en'];
  stinger();
  const flash = el('div', 'dr-flash');
  flash.setAttribute('aria-hidden', 'true');
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 650);
  try { localStorage.setItem('mm-heart', '1'); } catch { /* private mode */ }
  trophy();

  const root = el('div', 'hs');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'hs-title');
  const card = el('div', 'hs-card');
  const pic = el('img', 'hs-pic');
  pic.src = '/halloween/scream.webp';
  pic.alt = '';
  const title = el('h2', 'hs-title', w.title);
  title.id = 'hs-title';
  card.append(pic, title, ...w.body.map((t) => el('p', 'hs-text', t)));
  const close = el('button', 'btn hs-close', w.close);
  close.type = 'button';
  card.appendChild(close);
  root.appendChild(card);
  setTimeout(() => {
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('on'));
    close.focus();
  }, 600);
  const done = () => {
    root.classList.remove('on');
    setTimeout(() => root.remove(), 400);
    from.focus();
  };
  close.addEventListener('click', done);
  root.addEventListener('click', (e) => { if (e.target === root) done(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
}

export function mountHeart(): void {
  const lost = document.querySelector('article.lost');
  if (!lost || lookNow() !== 'halloween') return;
  const ru = navigator.language.toLowerCase().startsWith('ru');
  const mask = el('button', 'hs-mask');
  mask.type = 'button';
  mask.setAttribute('aria-label', WORDS[ru ? 'ru' : 'en'].label);
  const face = el('img', '');
  face.src = '/halloween/face.webp';
  face.alt = '';
  mask.appendChild(face);
  lost.appendChild(mask);
  mask.addEventListener('click', () => reveal(ru, mask));
}
