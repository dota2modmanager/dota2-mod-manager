/**
 * The end of the night, on the page for an address that is not here (pages/404.astro).
 *
 * The app's pumpkin, once opened, says where to go next: where there is nothing on the site, find
 * his mask. It hangs there on a thread while Halloween is in season. Pressed, a telephone rings in
 * the dark; picked up, it says the oldest line in horror, and then shows what the mask was
 * hiding: the mod the pumpkin gives, what went into it and where it is kept.
 *
 * Whoever got that far keeps the mask in the footer of every page (mm-heart), all year and on any
 * screen, and pressing it there shows the mod again.
 */
import { lookNow } from './look';
import { ring, stinger, whisper } from './spook-sound';

const WORDS = {
  en: {
    label: 'A mask on a thread', again: 'Necrophos: Scream',
    pick: 'Pick up', hello: 'Hello?', line: 'Do you like scary movies?',
    title: 'Necrophos: Scream',
    body: [
      'A set for Necrophos made from nothing: a mask and hood of its own, a black robe, a bloody scythe, every effect of his turned red, new spell icons, and the look and sound of his immortals without owning them.',
      'It is not in the catalog. It is hidden in the night that runs between the site and the app: the eight on the site, the pumpkin in the app, and a key of your own that opens it once.',
    ],
    close: 'Close',
  },
  ru: {
    label: 'Маска на нитке', again: 'Некрофос: Крик',
    pick: 'Взять трубку', hello: 'Алло?', line: 'Ты любишь страшные фильмы?',
    title: 'Некрофос: Крик',
    body: [
      'Сет для Некрофоса, сделанный с нуля: своя маска и капюшон, чёрная мантия, окровавленная коса, все его эффекты в красном, новые иконки способностей, а ещё вид и звуки его имморталов без самих предметов.',
      'В каталоге его нет. Он спрятан в ночи, которая идёт между сайтом и приложением: восемь героев на сайте, тыква в приложении и твой собственный ключ, который откроет его один раз.',
    ],
    close: 'Закрыть',
  },
};
type Words = typeof WORDS.en;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A dark room over the page, closed by its button, a click outside or Escape. */
function room(from: HTMLElement): { root: HTMLElement; done: () => void } {
  const root = el('div', 'hs');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  document.body.appendChild(root);
  // laid out once at opacity 0, so the fade runs without waiting for a frame
  void root.offsetWidth;
  root.classList.add('on');
  const done = () => {
    root.classList.remove('on');
    setTimeout(() => root.remove(), 400);
    from.focus();
  };
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
  return { root, done };
}

/** The mod the mask was hiding, arriving with a scream. */
function preview(w: Words, root: HTMLElement, done: () => void): void {
  stinger();
  const card = el('div', 'hs-card');
  const pic = el('img', 'hs-pic');
  pic.src = '/halloween/scream.webp';
  pic.alt = '';
  const title = el('h2', 'hs-title', w.title);
  title.id = 'hs-title';
  root.setAttribute('aria-labelledby', 'hs-title');
  const close = el('button', 'btn hs-close', w.close);
  close.type = 'button';
  card.append(pic, title, ...w.body.map((t) => el('p', 'hs-text', t)), close);
  root.replaceChildren(card);
  setTimeout(() => card.classList.add('in'), 330);
  close.addEventListener('click', done);
  root.addEventListener('click', (e) => { if (e.target === root) done(); });
  close.focus();
}

/** The call: a ringing phone in the dark, the line, and then the mod. */
async function call(w: Words, from: HTMLElement): Promise<void> {
  const { root, done } = room(from);
  const phone = el('div', 'hs-phone', '☎');
  phone.setAttribute('aria-hidden', 'true');
  const said = el('p', 'hs-said');
  said.setAttribute('aria-live', 'polite');
  const pick = el('button', 'btn hs-pick', w.pick);
  pick.type = 'button';
  root.append(phone, said, pick);
  const hush = ring();
  pick.focus();
  await new Promise<void>((r) => pick.addEventListener('click', () => r(), { once: true }));
  hush();
  pick.remove();
  phone.classList.add('up');
  const type = async (text: string) => {
    said.textContent = '';
    for (const ch of text) { said.textContent += ch; await sleep(ch === ' ' ? 90 : 60 + Math.random() * 70); }
  };
  await sleep(1200);
  whisper();
  await type(w.hello);
  await sleep(1500);
  await type(w.line);
  await sleep(1800);
  try { localStorage.setItem('mm-heart', '1'); } catch { /* private mode */ }
  trophy();
  preview(w, root, done);
}

/** The mask in the footer, for whoever found it: pressed, it shows the mod again. */
function trophy(): void {
  let found = false;
  try { found = localStorage.getItem('mm-heart') === '1'; } catch { /* private mode */ }
  const legal = document.querySelector('.foot-legal');
  if (!found || !legal || legal.querySelector('.dr-trophy')) return;
  const w = WORDS[document.documentElement.lang === 'ru' ? 'ru' : 'en'];
  const mask = el('button', 'dr-trophy');
  mask.type = 'button';
  mask.setAttribute('aria-label', w.again);
  mask.title = w.line;
  const face = el('img', '');
  face.src = '/halloween/face.webp';
  face.alt = '';
  mask.appendChild(face);
  legal.appendChild(mask);
  mask.addEventListener('click', () => { const { root, done } = room(mask); preview(w, root, done); });
}

export function mountHeart(): void {
  trophy();
  const lost = document.querySelector('article.lost');
  if (!lost || lookNow() !== 'halloween') return;
  const w = WORDS[navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'];
  const mask = el('button', 'hs-mask');
  mask.type = 'button';
  mask.setAttribute('aria-label', w.label);
  const face = el('img', '');
  face.src = '/halloween/face.webp';
  face.alt = '';
  mask.appendChild(face);
  lost.appendChild(mask);
  let busy = false;
  mask.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    await call(w, mask);
    busy = false;
  });
}
