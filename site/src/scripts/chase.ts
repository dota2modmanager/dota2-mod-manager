/**
 * The last of the eight, which will not be caught until it is too tired to run.
 *
 * Hunt.astro hands over here when somebody clicks the one hero left in the margins. The page goes
 * dark, a red line of type shakes across it, and the hero runs from the pointer across the whole
 * screen. Running costs it breath: every second the pointer is close drains it, every lunge it
 * dodges drains it more, and a few seconds left alone give a little back. Spent, it can barely
 * crawl, and a click on it ends the night. Not the first time it is spent, though: it finds a
 * second wind once, and runs again. Now and then the lights go out and only its eyes are left.
 *
 * Tiredness is shown on the body, never on a bar. A fresh runner is fast, glows, saturated, and
 * drags a trail of its own afterimages; a spent one is grey, sways, pants and sweats. The heart
 * behind the screen slows with it, and the letters shake less as it goes. Watching it give up is
 * the point, so every one of those cues moves with the same number, its breath.
 *
 * Desktop only, like the hunt that leads here: Hunt.astro never starts it without a fine pointer
 * and with reduced motion asked for. Everything it makes it removes again, and the page under it
 * is never touched except to stop it scrolling while the chase is on.
 */

import { spook } from './spook-sound';
import { keptKey, type Claim } from './pumpkin-key';

export interface ChaseHero { id: string; primary: string; accent: string }

export interface ChaseWords {
  title: string; slowing: string; spent: string; wind: string; giveUp: string; sound: string;
  caught: string; keyIs: string; hint: string; copy: string; copied: string; again: string; close: string;
  claiming: string; early: string; enough: string; offline: string; broken: string; retry: string;
}

/** The words of the chase and of what it gives, in the page's language. */
export const CHASE_WORDS: Record<'en' | 'ru', ChaseWords> = {
  en: {
    title: 'CATCH ME', slowing: 'It is slowing down', spent: 'Out of breath. Grab it!', wind: 'Second wind. It is running again', giveUp: 'Esc to give up', sound: 'M for sound',
    caught: 'Caught', keyIs: 'Your key', hint: 'It opens one pumpkin in the app, yours, and only once. Posted in a channel, it burns for whoever is first.',
    copy: 'Copy', copied: 'Copied', again: 'Show my key', close: 'Close',
    claiming: 'Carving your key…', early: 'Too fast. Nobody catches it that fast.', enough: 'Enough keys from here for today. Come back tomorrow.',
    offline: 'The pumpkin cannot be reached. Check your connection.', broken: 'Something broke on the other side. Try again in a minute.', retry: 'Try again',
  },
  ru: {
    title: 'ПОЙМАЙ МЕНЯ', slowing: 'Он сбавляет ход', spent: 'Выдохся. Лови!', wind: 'Второе дыхание. Он снова бежит', giveUp: 'Esc - сдаться', sound: 'M - звук',
    caught: 'Пойман', keyIs: 'Твой ключ', hint: 'Он откроет одну тыкву в приложении, твою, и только один раз. Выложишь в канал - сгорит у того, кто успеет первым.',
    copy: 'Скопировать', copied: 'Скопировано', again: 'Показать мой ключ', close: 'Закрыть',
    claiming: 'Вырезаю твой ключ…', early: 'Слишком быстро. Так быстро его не ловят.', enough: 'На сегодня ключей отсюда хватит. Приходи завтра.',
    offline: 'Тыква не отвечает. Проверь интернет.', broken: 'На той стороне что-то сломалось. Попробуй через минуту.', retry: 'Ещё раз',
  },
};


// ---- tuning ---------------------------------------------------------------------------
const SIZE = 64;           // the runner, in CSS pixels
const SCARE = 320;         // how near the pointer has to come before it runs
const DRAIN = 0.04;        // breath lost per second with the pointer on top of it
const LUNGE = 0.012;       // and per click it dodges
const REST = 0.016;        // breath back per second when nobody is close
const SPENT = 0.1;         // below this it cannot run any more
const INTRO = 1.3;         // seconds of the page going dark, when nothing drains
// However quick the hand, it cannot be worn out before this many seconds of chase: the breath
// has a floor that sinks from half to nothing over them, so the tiring is always seen happening.
const STAMINA = 34;
const WIND = 0.45;         // the breath its one second wind gives back, a moment after it is first spent
const DARK_EVERY = 9;      // seconds between the lights going out, give or take a few
const DECOY_EVERY = 3.8;   // seconds between the false runners it throws off while it still has breath
const DECOY_GIFT = 0.1;    // breath it gets back when one of them is grabbed instead of it
const WALL = 110;          // how far from an edge the walls start pushing back

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A spider for the dark, drawn facing up. */
const SPIDER = '<svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="legs a"><polyline class="leg" points="-3,-2 -11,-10 -16,-6"/><polyline class="leg odd" points="-3,0 -13,-4 -18,1"/><polyline class="leg" points="-3,2 -12,4 -17,10"/><polyline class="leg odd" points="-3,4 -9,9 -12,16"/></g><g class="legs b"><polyline class="leg" points="3,-2 11,-10 16,-6"/><polyline class="leg odd" points="3,0 13,-4 18,1"/><polyline class="leg" points="3,2 12,4 17,10"/><polyline class="leg odd" points="3,4 9,9 12,16"/></g><ellipse class="ab" cx="0" cy="6" rx="6.4" ry="8"/><circle class="hd" cx="0" cy="-4" r="4.2"/><circle class="eye" cx="-1.6" cy="-5.2" r="1"/><circle class="eye" cx="1.6" cy="-5.2" r="1"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * Run the chase. Resolves 'caught' once the catch has played out and the page should change,
 * or 'gave-up' when Escape ended it; the overlay is on its way out in both cases.
 */
export function chase(opts: {
  hero: ChaseHero; from: { x: number; y: number }; palettes: string[][]; words: ChaseWords;
}): Promise<'caught' | 'gave-up'> {
  const { hero, from, palettes, words } = opts;
  return new Promise((resolve) => {
    const root = el('div', 'chase');
    root.setAttribute('aria-hidden', 'true');
    const pulse = el('div', 'chase-pulse');
    const title = el('p', 'chase-title');
    // A word to a line, and one span per letter, each with its own tremor, so the line shivers
    // rather than slides. On one line "ПОЙМАЙ МЕНЯ" ran off both sides of a 1440 px screen.
    let i = 0;
    for (const word of words.title.split(' ')) {
      const line = el('span', 'line');
      for (const ch of word) {
        const s = el('span', '', ch);
        s.style.setProperty('--i', String(i++));
        s.style.setProperty('--d', `${80 + Math.random() * 90}ms`);
        s.style.setProperty('--r', `${(Math.random() - 0.5) * 70}deg`);
        s.style.setProperty('--fx', `${(Math.random() - 0.5) * 260}px`);
        line.appendChild(s);
      }
      title.appendChild(line);
    }
    const sub = el('p', 'chase-sub');
    const esc = el('p', 'chase-esc', `${words.giveUp}    ${words.sound}`);
    // started inside the click that began the chase, which is what lets a page make a sound
    const sound = spook();
    let dodges = 0;
    const flash = el('div', 'chase-flash');
    // the lights out: black over everything but two red eyes where it is
    const dark = el('div', 'chase-dark');
    const eyes = el('div', 'chase-eyes');
    eyes.append(el('i', ''), el('i', ''));
    dark.appendChild(eyes);
    // and who is waiting for whoever catches it
    const mask = el('div', 'chase-mask');
    const fx = el('canvas', 'chase-fx');
    const runner = el('div', 'chase-runner');
    const img = el('img', '');
    img.src = `/mascots/${hero.id}.gif`;
    img.alt = '';
    runner.appendChild(img);
    // blood running down from the top of the dark, and spiders crossing it
    const blood = el('div', 'chase-blood');
    for (let k = 0; k < 28; k++) {
      const d = el('i', '');
      d.style.setProperty('--x', `${((k + 0.15 + Math.random() * 0.7) / 28) * 100}%`);
      d.style.setProperty('--w', `${(4 + Math.random() * 9).toFixed(1)}px`);
      d.style.setProperty('--h', `${(30 + Math.random() ** 1.5 * 260).toFixed(0)}px`);
      d.style.setProperty('--t', `${(5 + Math.random() * 7).toFixed(1)}s`);
      blood.appendChild(d);
    }
    const crawlers = el('div', 'chase-crawlers');
    for (let k = 0; k < 7; k++) {
      const s = el('span', 'chase-spider');
      s.innerHTML = SPIDER;
      s.style.setProperty('--y', `${(8 + Math.random() * 84).toFixed(0)}vh`);
      s.style.setProperty('--t', `${(6 + Math.random() * 9).toFixed(1)}s`);
      s.style.setProperty('--wait', `${(1.5 + Math.random() * 10).toFixed(1)}s`);
      s.style.setProperty('--size', `${(22 + Math.random() * 26).toFixed(0)}px`);
      if (k % 2) s.classList.add('back');
      crawlers.appendChild(s);
    }
    root.append(pulse, blood, crawlers, title, sub, fx, runner, dark, flash, mask, esc);
    document.body.appendChild(root);
    document.documentElement.classList.add('chasing');

    const ctx = fx.getContext('2d')!;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fx.width = Math.round(innerWidth * dpr);
      fx.height = Math.round(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // the type as large as the screen allows: measured at 100 px, then scaled to fit
      title.style.fontSize = '100px';
      const lines = Array.from(title.querySelectorAll<HTMLElement>('.line'));
      const wide = Math.max(...lines.map((l) => l.offsetWidth));
      const tall = title.offsetHeight;
      const size = Math.min((innerWidth * 0.86) / wide, (innerHeight * 0.6) / tall) * 100;
      title.style.fontSize = `${Math.floor(size)}px`;
      sub.style.top = `${Math.round(innerHeight / 2 + title.offsetHeight * 0.46 + 14)}px`;
    };
    fit();

    // ---- state ----
    let x = from.x, y = from.y;
    // it bolts for the middle of the screen as the lights go out
    let vx = (innerWidth / 2 - x) * 1.6, vy = (innerHeight / 2 - y) * 1.6;
    let breath = 1;
    let t = 0;
    let last = performance.now();
    let px = -9999, py = -9999, seen = false;
    let beat = 0;
    let over = false;
    let raf = 0;
    const trail: Array<{ x: number; y: number }> = [];
    type Bit = { x: number; y: number; vx: number; vy: number; r: number; life: number; dl: number; c: string; g: number };
    let bits: Bit[] = [];
    // the false runners it throws off: grab one of those and it gets some breath back
    type Decoy = { el: HTMLElement; x: number; y: number; vx: number; vy: number; life: number };
    let decoys: Decoy[] = [];
    let decoyClock = 0;
    let winded = 0;            // 0: not yet spent; above 0: seconds left until the second wind; -1: used
    let darkClock = DARK_EVERY * 0.6, darkLeft = 0;

    requestAnimationFrame(() => root.classList.add('on'));

    const onMove = (e: PointerEvent) => { px = e.clientX; py = e.clientY; seen = true; };
    const onLeave = () => { seen = false; };

    const spray = (cx: number, cy: number, colours: string[], n: number, speed: number, gravity = 0.25) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.35 + 0.65 * Math.sqrt(Math.random()));
        bits.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, r: 1 + Math.random() * 2.6, life: 1, dl: 0.012 + Math.random() * 0.012, c: colours[(Math.random() * colours.length) | 0], g: gravity });
      }
    };
    const sweat = () => {
      const side = Math.random() < 0.5 ? -1 : 1;
      bits.push({ x: x + side * 14, y: y - SIZE * 0.36, vx: side * (0.8 + Math.random() * 1.6), vy: -1.8 - Math.random() * 1.6, r: 1.6 + Math.random() * 1.4, life: 1, dl: 0.022, c: '#bfe3ff', g: 0.2 });
    };

    const jolt = () => {
      root.classList.remove('jolt');
      void root.offsetWidth;
      root.classList.add('jolt');
    };

    const end = (how: 'caught' | 'gave-up') => {
      over = true;
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      root.removeEventListener('pointerdown', onDown);
      const leave = () => {
        root.classList.remove('on');
        root.classList.add('off');
        document.documentElement.classList.remove('chasing');
        setTimeout(() => { cancelAnimationFrame(raf); root.remove(); }, 900);
        resolve(how);
      };
      if (how === 'gave-up') { sound.stop(); leave(); return; }
      sound.caught();
      setTimeout(() => sound.stop(), 3600);
      // The catch: a held breath, a flash, eight bursts in the eight palettes, and the line of
      // type falls apart. Then the lights come back on, in every colour at once.
      root.classList.add('caught');
      runner.classList.add('got');
      setTimeout(() => mask.classList.add('go'), 60);
      setTimeout(() => {
        flash.classList.add('go');
        palettes.forEach((p, i) => setTimeout(() => {
          const a = (i / palettes.length) * Math.PI * 2;
          spray(x + Math.cos(a) * 40, y + Math.sin(a) * 40, [...p, '#ffffff'], 46, 11, 0.18);
        }, i * 60));
      }, 160);
      setTimeout(leave, 1250);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end('gave-up');
      if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') sound.toggle();
    };

    const onDown = (e: PointerEvent) => {
      if (over) return;
      const d = Math.hypot(e.clientX - x, e.clientY - y);
      const spent = breath <= SPENT;
      // a false one grabbed instead of it: the false one bursts, and it laughs and breathes
      const fake = decoys.find((dc) => Math.hypot(e.clientX - dc.x, e.clientY - dc.y) < SIZE * 0.6);
      if (fake && d > SIZE * 0.72) {
        spray(fake.x, fake.y, ['#5a0710', '#a80f1b', '#2a2a2a'], 30, 7, 0.2);
        fake.el.remove();
        decoys = decoys.filter((dc) => dc !== fake);
        breath = Math.min(1, breath + DECOY_GIFT);
        sound.giggle();
        jolt();
        return;
      }
      if (d < SIZE * 0.72 && spent && t > INTRO) { end('caught'); return; }
      spray(e.clientX, e.clientY, ['#ff2a3a', '#ff7b54'], 10, 5, 0);
      if (d < 120 && t > INTRO * 0.6) {
        // a lunge it saw coming: it slips away, and it costs it
        const k = 900 + 1500 * breath;
        const dx = x - e.clientX, dy = y - e.clientY, n = Math.hypot(dx, dy) || 1;
        vx += (dx / n) * k; vy += (dy / n) * k;
        breath = Math.max(0, breath - LUNGE);
        jolt();
        sound.whoosh();
        if (++dodges % 3 === 0) sound.giggle();
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    root.addEventListener('pointerdown', onDown);

    let stage = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // a hidden tab is not a chase: nothing moves and nothing drains until it is back
      // Two clocks. The body moves in short steps so it never jumps through a wall, but breath,
      // the heart and the chase's length run on the real one: on a machine drawing few frames the
      // short steps added up slower than time, and a chase meant to last 14 s took minutes.
      const real = document.hidden ? 0 : Math.min(0.25, (now - last) / 1000);
      const dt = Math.min(0.033, real);
      last = now;
      if (!dt) return;
      t += real;
      const w = innerWidth, h = innerHeight;

      if (!over) {
        const dx = x - px, dy = y - py, d = Math.hypot(dx, dy) || 1;
        const threat = seen && t > INTRO * 0.6 ? clamp((SCARE - d) / SCARE, 0, 1) : 0;
        const spent = breath <= SPENT;
        const push = (spent ? 260 : 1700 + 5400 * breath) * threat;
        let ax = (dx / d) * push, ay = (dy / d) * push;
        // the walls push back, harder the closer it gets to one
        if (x < WALL) ax += (WALL - x) * 46;
        if (x > w - WALL) ax -= (x - (w - WALL)) * 46;
        if (y < WALL) ay += (WALL - y) * 46;
        if (y > h - WALL) ay -= (y - (h - WALL)) * 46;
        // cornered, it slides along the wall towards open screen instead of pressing into it
        if (threat > 0 && (x < WALL || x > w - WALL || y < WALL || y > h - WALL)) {
          let tx = -dy / d, ty = dx / d;
          if (tx * (w / 2 - x) + ty * (h / 2 - y) < 0) { tx = -tx; ty = -ty; }
          ax += tx * push; ay += ty * push;
        }
        // left alone it paces, so the screen never goes still
        if (threat === 0) { ax += Math.sin(t * 1.3) * 160; ay += Math.cos(t * 0.9) * 120; }
        vx += ax * dt; vy += ay * dt;
        const drag = Math.pow(0.05, dt);
        vx *= drag; vy *= drag;
        const top = 150 + 1250 * breath;
        const sp = Math.hypot(vx, vy);
        if (sp > top) { vx *= top / sp; vy *= top / sp; }
        x = clamp(x + vx * dt, SIZE / 2, w - SIZE / 2);
        y = clamp(y + vy * dt, SIZE / 2, h - SIZE / 2);

        const floor = 0.5 * clamp(1 - (t - INTRO) / STAMINA, 0, 1);
        if (t > INTRO) breath = clamp(breath - real * threat * DRAIN + (threat === 0 ? real * REST : 0), floor, 1);

        // the cues, all from the one number
        const tired = 1 - breath;
        const sway = tired ** 1.5 * 16 * Math.sin(t * 2.6) + clamp(vx / 1400, -1, 1) * 14;
        const pant = 0.08 * tired * Math.sin(t * (4 + 6 * breath));
        runner.style.transform = `translate3d(${x - SIZE / 2}px, ${y - SIZE / 2}px, 0) rotate(${sway.toFixed(2)}deg) scale(${(1 - pant * 0.6).toFixed(3)}, ${(1 + pant).toFixed(3)})`;
        runner.style.filter = `saturate(${(0.3 + 0.95 * breath).toFixed(2)}) brightness(${(0.7 + 0.42 * breath).toFixed(2)}) drop-shadow(0 0 ${(4 + 16 * breath).toFixed(1)}px ${hero.primary})`;
        title.style.setProperty('--amp', `${(0.5 + 7.5 * breath).toFixed(2)}px`);
        title.style.setProperty('--split', `${(1 + 6 * breath).toFixed(2)}px`);
        if (Math.random() < real * (tired > 0.25 ? 9 * tired ** 1.4 : 0)) sweat();

        // the first time it is spent it gets one more run out of itself, unless caught first
        if (spent && winded === 0) winded = 0.9;
        if (winded > 0 && (winded -= real) <= 0) {
          winded = -1;
          breath = WIND;
          vx += (Math.random() - 0.5) * 2400; vy += (Math.random() - 0.5) * 2400;
          sound.giggle();
          jolt();
          stage = 3;
          sub.textContent = words.wind;
          root.classList.remove('spent');
        }
        // the lights go out now and then while it can still run, and only its eyes are left
        if (t > INTRO && (darkClock -= real) <= 0 && breath > SPENT) {
          darkClock = DARK_EVERY * (0.7 + Math.random() * 0.6);
          darkLeft = 0.9 + Math.random() * 0.6;
          dark.classList.add('on');
          sound.giggle();
        }
        if (darkLeft > 0 && (darkLeft -= real) <= 0) dark.classList.remove('on');
        eyes.style.transform = `translate3d(${x - 14}px, ${y - SIZE * 0.22}px, 0)`;

        const next = spent ? 2 : stage === 3 ? 3 : breath < 0.55 ? 1 : 0;
        if (next !== stage) {
          stage = next;
          sub.textContent = stage === 2 ? words.spent : stage === 1 ? words.slowing : stage === 3 ? words.wind : '';
          root.classList.toggle('spent', stage === 2);
        }
        // the heart: lub-dub, fast while it is fresh, slow as it gives out
        const was = beat % 1;
        beat += real * (55 + 95 * breath) / 60;
        const ph = beat % 1;
        // the heart you hear is the one you see: a thump on each of the two peaks
        if ((was < 0.06 && ph >= 0.06) || (ph < was && ph >= 0.06)) sound.heart(0.5 + 0.5 * breath);
        else if (was < 0.24 && ph >= 0.24) sound.heart(0.3 + 0.3 * breath);
        sound.feet(Math.hypot(vx, vy));
        if ((t * 2 | 0) !== ((t - real) * 2 | 0)) sound.tension(breath);
        const lub = Math.exp(-(((ph - 0.06) / 0.05) ** 2)) + 0.6 * Math.exp(-(((ph - 0.24) / 0.05) ** 2));
        pulse.style.opacity = (0.3 + 0.7 * lub * (0.35 + 0.65 * breath)).toFixed(3);

        trail.push({ x, y });
        if (trail.length > 12) trail.shift();

        // a false runner thrown off now and then while it still has the breath for tricks
        decoyClock += real;
        if (t > INTRO && breath > SPENT + 0.12 && decoyClock > DECOY_EVERY) {
          decoyClock = 0;
          const dc = el('div', 'chase-runner chase-decoy');
          const im = el('img', '');
          im.src = img.src;
          im.alt = '';
          dc.appendChild(im);
          root.insertBefore(dc, runner);
          const a = Math.random() * Math.PI * 2;
          decoys.push({ el: dc, x, y, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, life: 3.2 });
          // and it darts the other way as the false one leaves
          vx -= Math.cos(a) * 600; vy -= Math.sin(a) * 600;
        }
        decoys = decoys.filter((dc) => {
          dc.life -= real;
          dc.vx *= Math.pow(0.15, dt); dc.vy *= Math.pow(0.15, dt);
          dc.x = clamp(dc.x + dc.vx * dt, SIZE / 2, w - SIZE / 2);
          dc.y = clamp(dc.y + dc.vy * dt, SIZE / 2, h - SIZE / 2);
          dc.el.style.transform = `translate3d(${dc.x - SIZE / 2}px, ${dc.y - SIZE / 2}px, 0)`;
          dc.el.style.opacity = String(Math.min(1, dc.life));
          if (dc.life <= 0) { dc.el.remove(); return false; }
          return true;
        });
      }

      // ---- the canvas: its afterimages, its sweat, the bursts ----
      ctx.clearRect(0, 0, w, h);
      if (!over && img.complete) {
        const sp = Math.hypot(vx, vy) / 1400;
        for (let i = 0; i < trail.length - 1; i++) {
          ctx.globalAlpha = (i / trail.length) * 0.4 * breath * clamp(sp, 0, 1);
          ctx.drawImage(img, trail[i].x - SIZE / 2, trail[i].y - SIZE / 2, SIZE, SIZE);
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      const alive: Bit[] = [];
      for (const b of bits) {
        if ((b.life -= b.dl) <= 0) continue;
        alive.push(b);
        b.vy += b.g;
        b.vx *= 0.92; b.vy *= 0.92;
        b.x += b.vx; b.y += b.vy;
        ctx.globalAlpha = b.life * b.life;
        ctx.fillStyle = b.c;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * (0.4 + 0.6 * b.life), 0, Math.PI * 2);
        ctx.fill();
      }
      bits = alive;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
  });
}

/**
 * The prize: a key of this person's own, in the middle of the screen, with a way to copy it. It
 * stays until it is closed, since it has to be written down, and Hunt.astro offers it again from
 * the footer. `got` is the worker's answer on its way (scripts/pumpkin-key.ts); with nothing passed
 * the key this browser was given before is shown. A failed claim says why, and offers to try again
 * when trying again could help.
 */
export function showKey(words: ChaseWords, got?: Promise<Claim>, again?: () => Promise<Claim>): void {
  document.querySelector('.hunt-key')?.remove();
  const box = el('div', 'hunt-key');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', words.caught);
  const head = el('b', 'hunt-key-title', words.caught);
  const label = el('span', 'hunt-key-label', words.keyIs);
  const code = el('output', 'hunt-key-code', words.claiming);
  code.classList.add('waiting');
  const copy = el('button', 'btn btn-glow hunt-key-copy', words.copy);
  copy.type = 'button';
  copy.hidden = true;
  const hint = el('small', 'hunt-key-hint', words.hint);
  const close = el('button', 'icon-btn hunt-close', '');
  close.type = 'button';
  close.setAttribute('aria-label', words.close);
  close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>';
  box.append(head, label, code, copy, hint, close);
  document.body.appendChild(box);

  let key = '';
  const settle = (c: Claim) => {
    code.classList.remove('waiting');
    if ('key' in c) {
      key = c.key;
      code.textContent = c.key;
      copy.textContent = words.copy;
      copy.hidden = false;
      copy.onclick = onCopy;
      copy.focus();
      return;
    }
    code.classList.add('failed');
    code.textContent = words[c.error];
    // too fast or too many will not change with another try; the network might
    if (again && (c.error === 'offline' || c.error === 'broken')) {
      copy.hidden = false;
      copy.textContent = words.retry;
      copy.onclick = () => { code.classList.remove('failed'); code.classList.add('waiting'); code.textContent = words.claiming; copy.hidden = true; void again().then(settle); };
    }
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(key);
      copy.textContent = words.copied;
    } catch {
      // no clipboard here: select the key so a Ctrl+C takes it
      const r = document.createRange();
      r.selectNodeContents(code);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
    }
  };
  if (got) void got.then(settle);
  else { const k = keptKey(); settle(k ? { key: k } : { error: 'broken' }); }

  const shut = () => { box.classList.add('out'); setTimeout(() => box.remove(), 260); window.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') shut(); };
  window.addEventListener('keydown', onKey);
  close.addEventListener('click', shut);
  close.focus();
}
