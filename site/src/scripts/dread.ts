/**
 * What Halloween does to the page itself, past the webs and spiders of scripts/halloween.ts: the
 * part everybody sees while the season is on, earned or not, because it is where the hunt starts.
 *
 * Headings bleed: drops gather under the letters, stretch and fall. Fingers grip the top edge of a
 * card here and there, as if somebody were climbing out from behind it, and slide back down when
 * the pointer comes near. Screenshots get a frame of dried blood. A few words in the text are not
 * what they seem, and say something else under the pointer. Eyes open in the margins, follow the
 * pointer, shut when it comes close, and whisper when touched: what they whisper is how the hunt
 * goes on in the app and back again. Somebody in a mask looks in from the edge of the screen when
 * the pointer has been still too long, and he is in a screenshot for a moment if it is stared at.
 *
 * A fine pointer with motion allowed only, the same as the hunt and its notes; switched off with
 * the rest by the footer's switch (mm-rainbow "0"). aria-hidden throughout: the words that change
 * keep their own text for a screen reader, and nothing here is needed to use the site.
 */
import { lookNow } from './look';
import { whisper, stinger } from './spook-sound';

type Say = { en: string; ru: string };

/** What the eyes whisper, in turn. The first three are the way into the app's half of the hunt. */
const WHISPERS: Say[] = [
  { en: 'The one in the corner of the app\'s window. Knock on him twenty times. I count from the first.', ru: 'Тот, кто сидит в углу окна приложения. Постучи по нему двадцать раз. Считаю с первого.' },
  { en: 'The pumpkin in the app is hungry. It eats what the mother of spiders leaves behind.', ru: 'Тыква в приложении голодна. Она ест то, что оставляет мать пауков.' },
  { en: 'Only the pumpkin knows the fourth.', ru: 'Четвёртого знает только тыква.' },
  { en: 'His mask hangs on the page that is not here.', ru: 'Его маска висит на странице, которой нет.' },
  { en: 'He wears a mask now. He carries a phone.', ru: 'Теперь он носит маску. И у него есть телефон.' },
  { en: 'Do not look behind you.', ru: 'Не оглядывайся.' },
];

/** What a possessed word says instead, under the pointer. */
const WORDS: Say[] = [
  { en: 'twenty knocks', ru: 'двадцать стуков' },
  { en: 'he is behind you', ru: 'он за спиной' },
  { en: 'feed the pumpkin', ru: 'покорми тыкву' },
  { en: 'the cocoon', ru: 'кокон' },
  { en: 'his heart stops', ru: 'сердце остановится' },
  { en: 'run', ru: 'беги' },
  { en: 'the mask', ru: 'маска' },
];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.setAttribute('aria-hidden', 'true');
  return e;
}

/** Four fingers curled over an edge from behind it, nails and creases, and what runs from them. */
const FINGERS = `<svg viewBox="0 0 84 50" aria-hidden="true">
  <g class="smear"><path d="M13 38v12"/><path d="M30 43v14"/><path d="M47 42v14"/><path d="M63 36v11"/></g>
  <g class="hand">
    <path d="M8 22C8 8 20 8 20 22L19.4 37Q14 42 8.6 37Z"/><path d="M24 22C24 8 38 8 38 22L37.4 42Q31 47 24.6 42Z"/>
    <path d="M41 22C41 8 55 8 55 22L54.4 41Q48 46 41.6 41Z"/><path d="M58.5 22C58.5 8 69.5 8 69.5 22L68.9 35Q64 40 59.1 35Z"/>
  </g>
  <g class="nail">
    <path d="M10.4 31h7.2v4q-3.6 4-7.2 0z"/><path d="M26.8 36h8.4v4q-4.2 4-8.4 0z"/>
    <path d="M43.8 35h8.4v4q-4.2 4-8.4 0z"/><path d="M60.7 29h6.6v4q-3.3 4-6.6 0z"/>
  </g>
  <g class="knuckle">
    <path d="M11 16q3-2 6 0M11 28.8h6"/><path d="M27.5 16q3.5-2 7 0M27.5 31h7"/>
    <path d="M44.5 16q3.5-2 7 0M44.5 30.6h7"/><path d="M61.3 16q2.7-2 5.5 0M61.3 27.9h5.5"/>
  </g>
</svg>`;

let mounted = false;

export function mountDread(): void {
  if (mounted) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let off = false;
  try { off = localStorage.getItem('mm-rainbow') === '0'; } catch { /* private mode */ }
  if (!fine || still || off || lookNow() !== 'halloween') return;
  mounted = true;
  const html = document.documentElement;
  html.classList.add('dread');
  const ru = document.querySelector('article.lost') ? navigator.language.toLowerCase().startsWith('ru') : html.lang === 'ru';
  const say = (s: Say) => (ru ? s.ru : s.en);
  const main = document.querySelector('main') ?? document.body;

  // ---- words that are not what they seem ----
  const prose = [...main.querySelectorAll<HTMLElement>('p')].filter((p) => !p.closest('a, button, nav, .hunt-notes') && p.textContent!.length > 80);
  const words = WORDS.slice().sort(() => Math.random() - 0.5);
  for (const p of prose.sort(() => Math.random() - 0.5).slice(0, 3)) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) if (!(walker.currentNode.parentElement?.closest('a, code'))) nodes.push(walker.currentNode as Text);
    const node = pick(nodes.filter((n) => /\p{L}{6,}/u.test(n.data)));
    if (!node) continue;
    const found = [...node.data.matchAll(/\p{L}{6,}/gu)];
    const m = pick(found);
    const after = node.splitText(m.index!);
    after.splitText(m[0].length);
    const span = document.createElement('span');
    span.className = 'dr-word';
    span.dataset.alt = say(words.pop() ?? WORDS[0]);
    after.replaceWith(span);
    span.appendChild(after);
  }

  // ---- things placed on the page itself, put back wherever the layout moves them ----
  const placed: Array<() => void> = [];
  const place = () => { for (const f of placed) f(); };
  const pageBox = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };

  // headings that bleed: drops hang from the foot of a few letters on the last line, each
  // from a stroke that really reaches the baseline (laid over the page, not put inside: a
  // heading's letters are a gradient clipped to the text, and that would clip the drops too)
  const LOW = /[gjpqyуцщрдфз,.]/i;          // these hang below the line: no drop from them
  const STEM = /[AHKMNVWXYhkmnrvwxПНИЙЛМКЖХШЩЧЯАпнийлмкжхшчяа]/;   // these touch it at the left stroke
  const ruler = document.createElement('canvas').getContext('2d')!;
  for (const h of [...main.querySelectorAll<HTMLElement>('h1, h2')].slice(0, 24)) {
    const cs = getComputedStyle(h);
    const size = parseFloat(cs.fontSize);
    ruler.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const ascent = ruler.measureText('H').fontBoundingBoxAscent;
    const w = Math.max(3, size * 0.05);
    const drips = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => {
      const d = el('i', 'dr-drip');
      d.style.setProperty('--w', `${w.toFixed(1)}px`);
      d.style.setProperty('--h', `${Math.round(size * (0.2 + Math.random() * 0.45))}px`);
      d.style.setProperty('--t', `${5 + Math.random() * 7}s`);
      d.style.setProperty('--wait', `${-Math.random() * 10}s`);
      document.body.appendChild(d);
      return d;
    });
    let chosen: number[] | null = null;
    placed.push(() => {
      // every letter of the heading with its box, then the ones on its last line that can bleed
      const letters: Array<{ ch: string; r: DOMRect }> = [];
      const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        for (let i = 0; i < t.data.length; i++) {
          if (!/\p{L}/u.test(t.data[i])) continue;
          r.setStart(t, i); r.setEnd(t, i + 1);
          const box = r.getBoundingClientRect();
          if (box.width) letters.push({ ch: t.data[i], r: box });
        }
      }
      const bottom = Math.max(...letters.map((l) => l.r.bottom));
      const can = letters.filter((l) => Math.abs(l.r.bottom - bottom) < 4 && !LOW.test(l.ch));
      chosen ??= can.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, drips.length);
      drips.forEach((d, k) => {
        const l = can[chosen![k]];
        d.hidden = !l;
        if (!l) return;
        const x = l.r.left + (STEM.test(l.ch) ? l.r.width * 0.2 : l.r.width / 2) - w / 2;
        d.style.left = `${Math.round(x + scrollX)}px`;
        d.style.top = `${Math.round(l.r.top + ascent + scrollY - w * 0.6)}px`;
      });
    });
  }

  // fingers over the top edge of a few cards, gone back down when the pointer comes near
  const rows = new Set<number>();
  const cards = [...main.querySelectorAll<HTMLElement>('.card, .tile, .mcard, .htile, .panel, .link-card, .release')]
    .filter((c) => c.getBoundingClientRect().width > 160).sort(() => Math.random() - 0.5)
    // one to a row of cards: two hands side by side read as a pattern, not as somebody
    .filter((c) => { const y = Math.round(c.getBoundingClientRect().top + scrollY); if (rows.has(y)) return false; rows.add(y); return true; })
    .slice(0, 3);
  const hands = cards.map((card) => {
    const grip = el('div', 'dr-grip');
    grip.innerHTML = FINGERS;
    document.body.appendChild(grip);
    const at = 0.15 + Math.random() * 0.6;
    placed.push(() => {
      const b = pageBox(card);
      grip.style.left = `${Math.round(b.x + (b.w - 84) * at)}px`;
      grip.style.top = `${Math.round(b.y - 22)}px`;
    });
    return grip;
  });

  // a frame of dried blood round the screenshots: the big pictures, not the mods' little cards
  const shots = [...main.querySelectorAll<HTMLElement>('img, video')]
    .filter((m) => m.getBoundingClientRect().width >= 360 && !m.closest('.mcard, .tile, .htile, .card'));
  for (const m of shots.slice(0, 6)) m.classList.add('dr-framed');

  place();
  addEventListener('resize', place);
  addEventListener('load', place);
  setTimeout(place, 1500);

  // ---- eyes on the page: in the margins where there are margins, else in the empty strip
  // above a section, where nothing is written; somewhere else each time they open ----
  const eyes: Array<{ box: HTMLElement; pupils: HTMLElement[]; shut: boolean }> = [];
  let told = 0;
  // never on top of one of the hunt's heroes, nor next to another pair of eyes
  const crowded = (x: number, y: number, self: HTMLElement) => [
    ...[...document.querySelectorAll('.hunt-hero')].map((e) => pageBox(e)),
    ...eyes.filter((e) => e.box !== self && !e.box.classList.contains('gone')).map((e) => pageBox(e.box)),
  ].some((b) => Math.hypot(b.x + b.w / 2 - (x + 30), b.y + b.h / 2 - (y + 12)) < 170);
  const openEyes = (box: HTMLElement) => {
    for (let tries = 0; tries < 24; tries++) {
      const [x, y] = spot();
      if (tries < 23 && crowded(x, y, box)) continue;
      box.style.left = `${Math.round(Math.max(4, x))}px`;
      box.style.top = `${Math.round(y)}px`;
      break;
    }
    box.classList.remove('gone');
  };
  const spot = (): [number, number] => {
    const vw = document.documentElement.clientWidth;
    const g = Math.max(0, (vw - Math.min(1200, vw)) / 2);
    const strips = [...main.querySelectorAll<HTMLElement>('section')].filter((s) => parseFloat(getComputedStyle(s).paddingTop) >= 40);
    let x: number, y: number;
    if (g >= 90) {
      x = Math.random() < 0.5 ? g * (0.15 + Math.random() * 0.4) : vw - g * (0.55 + Math.random() * 0.4) - 60;
      y = 200 + Math.random() * Math.max(0, document.documentElement.scrollHeight - 600);
    } else if (!strips.length) {
      x = 8 + Math.random() * (vw - 90);
      y = 200 + Math.random() * Math.max(0, document.documentElement.scrollHeight - 600);
    } else {
      const s = pageBox(pick(strips));
      x = 16 + Math.random() * (vw - 100);
      y = s.y + 6;
    }
    return [x, y];
  };
  for (let i = 0; i < 3; i++) {
    const box = el('div', 'dr-eyes gone');
    box.removeAttribute('aria-hidden');
    box.setAttribute('role', 'presentation');
    const pupils = [0, 1].map(() => { const e = document.createElement('i'); const p = document.createElement('b'); e.appendChild(p); box.appendChild(e); return p; });
    document.body.appendChild(box);
    eyes.push({ box, pupils, shut: false });
    // a moment after the page, once the hunt has put its heroes where they go
    setTimeout(() => openEyes(box), 900 + i * 300);
    box.addEventListener('click', () => {
      whisper();
      const bubble = el('p', 'dr-whisper');
      bubble.textContent = say(WHISPERS[told++ % WHISPERS.length]);
      const r = box.getBoundingClientRect();
      // on the page beside the eyes, so it stays where they were as the page scrolls
      bubble.style.top = `${Math.round(r.bottom + scrollY + 8)}px`;
      bubble.style.left = `${Math.round(Math.min(document.documentElement.clientWidth - 300, Math.max(12, r.left - 110)) + scrollX)}px`;
      document.body.appendChild(bubble);
      setTimeout(() => bubble.remove(), 6500);
      box.classList.add('gone');
      setTimeout(() => openEyes(box), 9000 + Math.random() * 9000);
    });
  }

  // a window made narrower or wider puts them somewhere they fit
  addEventListener('resize', () => { for (const e of eyes) openEyes(e.box); });

  // ---- the pointer: eyes follow it, fingers drop away from it, stillness brings the mask ----
  let px = -9999, py = -9999, lastMove = performance.now(), queued = false;
  const look = () => {
    queued = false;
    for (const e of eyes) {
      if (e.box.hidden) continue;
      const r = e.box.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(px - cx, py - cy);
      e.box.classList.toggle('shut', d < 110);
      const a = Math.atan2(py - cy, px - cx), k = Math.min(1, d / 300) * 4;
      for (const p of e.pupils) p.style.translate = `${(Math.cos(a) * k).toFixed(1)}px ${(Math.sin(a) * k).toFixed(1)}px`;
    }
    for (const g of hands) {
      const r = g.getBoundingClientRect();
      const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
      if (d < 130) g.classList.add('gone');
      else if (d > 420 && g.classList.contains('gone') && Math.random() < 0.02) g.classList.remove('gone');
    }
  };
  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY; lastMove = performance.now();
    peek?.classList.remove('in');
    if (!queued) { queued = true; requestAnimationFrame(look); }
  }, { passive: true });

  // the eyes blink, out of step
  const blink = () => {
    const e = pick(eyes);
    e?.box.classList.add('blink');
    setTimeout(() => e?.box.classList.remove('blink'), 160);
    setTimeout(blink, 2500 + Math.random() * 5000);
  };
  setTimeout(blink, 3000);

  // somebody in a mask looks in from the side when the pointer has been still too long
  const peek = el('button', 'dr-peek');
  peek.type = 'button';
  peek.tabIndex = -1;
  const face = document.createElement('img');
  face.src = '/halloween/face.webp';
  face.alt = '';
  peek.appendChild(face);
  document.body.appendChild(peek);
  const flash = (ms: number) => {
    const f = el('div', 'dr-flash');
    document.body.appendChild(f);
    setTimeout(() => f.remove(), ms);
  };
  peek.addEventListener('click', () => { peek.classList.remove('in'); stinger(); flash(420); });
  const lurk = () => {
    if (performance.now() - lastMove > 7000 && !document.hidden) {
      peek.classList.toggle('right', Math.random() < 0.5);
      peek.style.top = `${Math.round(innerHeight * (0.3 + Math.random() * 0.4))}px`;
      peek.classList.add('in');
      setTimeout(() => peek.classList.remove('in'), 3800);
    }
    setTimeout(lurk, 18000 + Math.random() * 22000);
  };
  setTimeout(lurk, 12000);

  // and he is in a screenshot, for a blink, if it is stared at long enough
  let stare = 0, seen = false;
  for (const img of main.querySelectorAll<HTMLElement>('.dr-framed')) {
    img.addEventListener('pointerenter', () => {
      if (seen) return;
      stare = window.setTimeout(() => {
        seen = true;
        const r = img.getBoundingClientRect();
        const ghost = el('div', 'dr-ghost');
        Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        document.body.appendChild(ghost);
        setTimeout(() => ghost.remove(), 110);
      }, 2600);
    });
    img.addEventListener('pointerleave', () => clearTimeout(stare));
  }

  trophy();
}

/** Whoever found his mask (scripts/heart.ts) keeps it, in the footer of every page. */
export function trophy(): void {
  let heart = false;
  try { heart = localStorage.getItem('mm-heart') === '1'; } catch { /* private mode */ }
  const legal = document.querySelector('.foot-legal');
  if (!heart || !legal || legal.querySelector('.dr-trophy')) return;
  const mask = el('img', 'dr-trophy');
  mask.src = '/halloween/face.webp';
  mask.alt = '';
  mask.title = document.documentElement.lang === 'ru' ? 'Ты любишь страшные фильмы?' : 'Do you like scary movies?';
  legal.appendChild(mask);
}
