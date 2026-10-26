/**
 * The end of the night, on the page for an address that is not here (pages/404.astro).
 *
 * The app's pumpkin, once opened, says where to go next: where there is nothing on the site, name
 * his heart. Everybody who plays the game knows the name of Necrophos' heart. Typed anywhere on
 * this page, in either keyboard layout or in Russian, it makes a telephone ring. Picking up plays
 * the oldest call in horror, and then he is there, in the mask of the mod the app's pumpkin gave. Whoever got that far keeps
 * the mask in the footer of every page (scripts/dread.ts, mm-heart).
 *
 * The words are compared by their SHA-256, so reading this file gives away the place and not the
 * name. Only while Halloween is in season.
 */
import { lookNow } from './look';
import { ring, stinger, whisper } from './spook-sound';
import { trophy } from './dread';

const HEARTS = new Set([
  '3667af449558d78faaaadf4426580e6051ee76e04ba507a501b5d12e443fc8c3',
  '0da38ac694fbcb8b17de54b2d0ae6157cbdc79f09bb36e6ee93277f027aca514',
  '9680fcfe1e416fb1dccd9c2b26bd485298bf24caba205a095820473895ba5746',
  '658afb2671f60a77fa0a977e4a913bb48edf96f9e28771ba29771a6f73292244',
]);
const LENGTHS = [12, 15, 16, 19];

const WORDS = {
  en: { pick: 'Pick up', hello: 'Hello?', line: 'Do you like scary movies?', end: 'You named his heart, and it stopped. The mask is yours now.', close: 'Hang up' },
  ru: { pick: 'Взять трубку', hello: 'Алло?', line: 'Ты любишь страшные фильмы?', end: 'Ты назвал его сердце, и оно остановилось. Маска теперь твоя.', close: 'Положить трубку' },
};

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

async function call(ru: boolean): Promise<void> {
  const w = WORDS[ru ? 'ru' : 'en'];
  const root = el('div', 'hs');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const phone = el('div', 'hs-phone', '☎');
  phone.setAttribute('aria-hidden', 'true');
  const pick = el('button', 'btn hs-pick', w.pick);
  pick.type = 'button';
  const said = el('p', 'hs-said');
  said.setAttribute('aria-live', 'polite');
  root.append(phone, said, pick);
  document.body.appendChild(root);
  document.documentElement.classList.add('chasing');
  requestAnimationFrame(() => root.classList.add('on'));
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
  await sleep(1400);
  whisper();
  await type(w.hello);
  await sleep(1600);
  await type(w.line);
  await sleep(2200);

  stinger();
  await sleep(330);
  root.classList.add('scream');
  try { localStorage.setItem('mm-heart', '1'); } catch { /* private mode */ }
  trophy();
  await sleep(1500);
  root.classList.add('after');
  said.textContent = w.end;
  const close = el('button', 'btn ghost hs-close', w.close);
  close.type = 'button';
  root.appendChild(close);
  close.focus();
  const done = () => {
    root.classList.remove('on');
    document.documentElement.classList.remove('chasing');
    setTimeout(() => root.remove(), 600);
  };
  close.addEventListener('click', done, { once: true });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
}

export function mountHeart(): void {
  if (!document.querySelector('article.lost') || lookNow() !== 'halloween') return;
  const ru = navigator.language.toLowerCase().startsWith('ru');
  // a caret blinking under the code, as if something were waiting to be typed
  const code = document.querySelector('.lost .code');
  if (code) { const caret = el('span', 'hs-caret', '_'); caret.setAttribute('aria-hidden', 'true'); code.after(caret); }

  // what is typed, twice: by the key's place on the keyboard (whatever layout it is in), and as typed
  let byPlace = '', asTyped = '', busy = false;
  addEventListener('keydown', async (e) => {
    if (busy || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^Key[A-Z]$/.test(e.code)) byPlace = (byPlace + e.code.slice(3).toLowerCase()).slice(-24);
    if (/^\p{L}$/u.test(e.key)) asTyped = (asTyped + e.key.toLowerCase()).slice(-24);
    for (const s of [byPlace, asTyped]) {
      for (const n of LENGTHS) {
        if (s.length < n || !HEARTS.has(await sha(s.slice(-n)))) continue;
        busy = true;
        byPlace = asTyped = '';
        await call(ru);
        busy = false;
        return;
      }
    }
  });
}
