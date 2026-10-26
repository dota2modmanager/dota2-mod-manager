/**
 * The order of the hunt (components/Hunt.astro), scrawled across the site in pieces.
 *
 * Eight lines, one riddle each, numbered in the order the heroes have to be found, and no page
 * holds more than its own: the front page has the first and the last, the rest are on the
 * catalog, a hero's page, the guides, the changes, the page for a lost address and a mod's page.
 * Each line names its hero without the name, in a way somebody who plays the game reads at once.
 *
 * A line is written in blood just above the footer and is nearly invisible: it comes up only
 * where the pointer's light falls on it, the way the heroes do. It is there only while the
 * Halloween look is in season, and only for a fine pointer with motion allowed, since the hunt
 * itself is only there for those. aria-hidden for the reason Hunt.astro gives.
 */
import { lookNow } from './look';

type Line = { n: string; en: string; ru: string };

/** In the hunt's order: Meepo, Invoker, Bounty Hunter, Ursa, Storm Spirit, Brewmaster, Nature's Prophet, Axe.
 *  The fourth is not here: the app's pumpkin names him (renderer/ui/pumpkin.ts, its hint). */
const LINES: Line[] = [
  { n: 'I', en: 'First comes the one there is always more than one of.', ru: 'Первым приходит тот, кого всегда больше одного.' },
  { n: 'II', en: 'Second knows ten spells by heart and only three orbs.', ru: 'Второй помнит десять заклинаний наизусть, а сфер у него всего три.' },
  { n: 'III', en: 'Third is paid for every head.', ru: 'Третьему платят за каждую голову.' },
  { n: 'IV', en: "Only the pumpkin in the app's window knows the fourth. Feed it first.", ru: 'Четвёртого знает только тыква в окне приложения. Сначала накорми её.' },
  { n: 'V', en: 'Fifth arrives with the thunder.', ru: 'Пятый приходит вместе с громом.' },
  { n: 'VI', en: 'Sixth drowns his fear in a mug, and splits in three when it runs out.', ru: 'Шестой топит страх в кружке, а когда она пустеет, делится на троих.' },
  { n: 'VII', en: 'Seventh plants a forest wherever you run.', ru: 'Седьмой сажает лес везде, куда ты бежишь.' },
  { n: 'VIII', en: 'The last is red. He hangs in the middle, wrapped in silk, and waits for the seven.', ru: 'Последний - красный. Он висит посередине, в коконе, и ждёт, пока придут семеро.' },
];

/** Which lines this page holds, by its address with the language taken off. */
function linesHere(): Line[] {
  if (document.querySelector('article.lost')) return [LINES[5]];
  const path = location.pathname.replace(/^\/ru(?=\/|$)/, '') || '/';
  if (path === '/' || path === '/index.html') return [LINES[0], LINES[7]];
  if (/^\/catalog\/?$/.test(path)) return [LINES[1]];
  if (/^\/heroes\/[^/]+\/?$/.test(path)) return [LINES[2]];
  if (/^\/docs\/?$/.test(path)) return [LINES[3]];
  if (/^\/changes\/?$/.test(path)) return [LINES[4]];
  if (/^\/mods\/[^/]+\/?$/.test(path)) return [LINES[6]];
  return [];
}

export function mountHuntNotes(): void {
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || still || lookNow() !== 'halloween') return;
  const foot = document.querySelector('.foot');
  const lines = linesHere();
  if (!foot || !lines.length) return;

  // the lost page speaks both languages, so its line follows the browser's
  const ru = document.querySelector('article.lost')
    ? navigator.language.toLowerCase().startsWith('ru')
    : document.documentElement.lang === 'ru';

  const wall = document.createElement('div');
  wall.className = 'hunt-notes';
  wall.setAttribute('aria-hidden', 'true');
  const notes = lines.map((l, i) => {
    const p = document.createElement('p');
    p.className = 'hunt-note';
    const b = document.createElement('b');
    b.textContent = `${l.n}.`;
    p.append(b, ` ${ru ? l.ru : l.en}`);
    p.style.setProperty('--tilt', `${(i % 2 ? 1.4 : -1.1) + (Math.random() - 0.5)}deg`);
    wall.appendChild(p);
    return p;
  });
  foot.before(wall);

  // the same light as the hunt's: heat from the distance to the pointer, nothing read per frame
  // but the notes' own boxes, and nothing at all while the pointer is still
  let px = -9999, py = -9999, queued = false;
  const NEAR = 60, FAR = 260;
  const light = () => {
    queued = false;
    for (const p of notes) {
      const r = p.getBoundingClientRect();
      const dx = Math.max(r.left - px, 0, px - r.right);
      const dy = Math.max(r.top - py, 0, py - r.bottom);
      const k = Math.max(0, Math.min(1, (FAR - Math.hypot(dx, dy)) / (FAR - NEAR)));
      p.style.setProperty('--heat', (k ** 1.8).toFixed(3));
      p.style.setProperty('--lx', `${Math.round(px - r.left)}px`);
    }
  };
  const wake = () => { if (!queued) { queued = true; requestAnimationFrame(light); } };
  addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; wake(); }, { passive: true });
  addEventListener('scroll', wake, { passive: true });

  // and for whoever opens the console looking for a way in
  console.log(
    `%c${ru ? 'Восемь на главной. Порядок разбросан по сайту, по строчке на страницу. Пишут кровью у самого низа.' : 'Eight on the front page. The order is scattered across the site, a line to a page, written in blood at the very bottom.'}`,
    'color:#ff2a3a;font:600 13px/1.5 system-ui;text-shadow:0 0 6px #600',
  );
}
