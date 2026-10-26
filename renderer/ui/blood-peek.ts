/* Somebody in a mask, looking in from the edge of the window while nobody moves (ui/blood.ts).
 *
 * Five seconds of a still pointer and he leans in from one side; the moment it moves he slides
 * back out, and if nobody moves he leaves on his own after a while. Once gone he waits a little
 * before coming back, so a person reading something long gets a visit, not a lodger. */
import { div, screamMask } from './blood-art.ts';

const IDLE = 5000;     // a still pointer for this long brings him
const STAY = 9000;     // and he stays at most this long
const REST = 12000;    // then keeps away for at least this long

export function peeker(layer: HTMLElement, bars: () => { top: number; bottom: number }): () => void {
  let lastMove = performance.now(), leftAt = -REST, mask: HTMLElement | null = null, stay = 0;
  const leave = () => {
    const m = mask;
    if (!m) return;
    mask = null;
    clearTimeout(stay);
    leftAt = performance.now();
    m.classList.add('gone');
    m.addEventListener('animationend', () => m.remove(), { once: true });
    setTimeout(() => m.remove(), 1200);
  };
  const moved = () => { lastMove = performance.now(); leave(); };
  const look = () => {
    const now = performance.now();
    if (mask || document.hidden || now - lastMove < IDLE || now - leftAt < REST) return;
    const { top, bottom } = bars();
    const m = div('bn-peek');
    m.classList.toggle('right', Math.random() < 0.5);
    m.style.top = `${(top + 60 + Math.random() * Math.max(0, innerHeight - top - bottom - 220)).toFixed(0)}px`;
    m.appendChild(screamMask());
    layer.appendChild(m);
    mask = m;
    stay = window.setTimeout(leave, STAY);
  };
  addEventListener('pointermove', moved, { passive: true });
  addEventListener('keydown', moved, { passive: true });
  const tick = window.setInterval(look, 1000);
  return () => {
    clearInterval(tick);
    clearTimeout(stay);
    removeEventListener('pointermove', moved);
    removeEventListener('keydown', moved);
  };
}
