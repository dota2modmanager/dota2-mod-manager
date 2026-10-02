/* Dragging a mod to a new place in the load order.
 *
 * The moves in a row's menu shift a mod one slot per press. Somebody who wants a mod to load
 * before thirty others pressed thirty times, which is what people wrote in to say.
 *
 * The rows make room under the pointer as it moves rather than at the moment it is released, so
 * the drop lands where the eye is already looking; the dragged row follows the pointer instead of
 * snapping between slots, and where it lands is decided by how many other rows the pointer has
 * passed the middle of. The list scrolls itself near the edges, because the row a mod has to end
 * up above is usually not on screen together with the one it started on.
 *
 * React owns the rows, so none of them moves in the page while the pointer is down: each is
 * shifted with a transform to where it would stand. The game folder is touched once, on release -
 * each slot is a real file name, so a new order renames files - and the list is drawn in its new
 * order when that is done, with the shifts taken off in the same frame. */
import { useEffect, useRef, type RefObject } from 'react';

interface Unit {
  row: HTMLElement;
  /** a pack's member rows, which travel with it */
  tail: HTMLElement | null;
  top: number;
  height: number;
  /** from this unit's top to the next one's: how far the rest moves when it leaves */
  span: number;
}

const EDGE = 76;

function scrollerOf(el: HTMLElement): HTMLElement {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 2) return n;
  }
  return (document.scrollingElement || document.documentElement) as HTMLElement;
}

function measure(list: HTMLElement): Unit[] {
  const base = list.getBoundingClientRect().top;
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  const rows = [...list.querySelectorAll<HTMLElement>('.lib-row[data-order]')];
  return rows.map((row) => {
    const next = row.nextElementSibling as HTMLElement | null;
    const tail = next?.classList.contains('pack-fold') ? next : null; // an open pack's members
    const last = tail && tail.offsetHeight ? tail : row;
    const after = (tail || row).nextElementSibling as HTMLElement | null;
    const r = row.getBoundingClientRect();
    const top = r.top - base;
    const end = after ? after.getBoundingClientRect().top - base : last.getBoundingClientRect().bottom - base + gap;
    return { row, tail, top, height: r.height, span: end - top };
  });
}

const shift = (u: Unit, dy: number) => {
  for (const el of [u.row, u.tail]) if (el) el.style.transform = dy ? `translateY(${dy}px)` : '';
};

export function useOrderDrag(listRef: RefObject<HTMLElement | null>, onDrop: (id: string, to: number) => Promise<void>): void {
  const drop = useRef(onDrop);
  drop.current = onDrop;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let drag: {
      me: Unit; units: Unit[]; others: Unit[]; from: number; to: number;
      clientY: number; grab: number; scroller: HTMLElement; raf: number;
    } | null = null;

    const listY = () => (drag ? drag.clientY - list.getBoundingClientRect().top : 0);
    // where a row that is not being dragged stands with the dragged one out of the list and put
    // back in at `to`
    const offset = (i: number, o: Unit, to: number, me: Unit) => (i >= to ? me.span : 0) - (o.top > me.top ? me.span : 0);

    const follow = () => {
      if (!drag) return;
      shift(drag.me, listY() - drag.grab - drag.me.top);
    };

    const place = () => {
      if (!drag) return;
      const { others, me, to } = drag;
      const y = listY();
      let at = others.findIndex((o, i) => y < o.top + offset(i, o, to, me) + o.height / 2);
      if (at === -1) at = others.length;
      if (at === to) return;
      drag.to = at;
      others.forEach((o, i) => shift(o, offset(i, o, at, me)));
    };

    const tick = () => {
      if (!drag) return;
      const b = drag.scroller.getBoundingClientRect();
      const overTop = EDGE - (drag.clientY - b.top);
      const overBottom = EDGE - (b.bottom - drag.clientY);
      const dy = overTop > 0 ? -Math.ceil(overTop / 3) : overBottom > 0 ? Math.ceil(overBottom / 3) : 0;
      if (dy) { drag.scroller.scrollTop += dy; follow(); place(); }
      drag.raf = requestAnimationFrame(tick);
    };

    const settle = (units: Unit[], row: HTMLElement) => {
      const els = units.flatMap((u) => [u.row, u.tail]).filter((el): el is HTMLElement => Boolean(el));
      for (const el of els) { el.style.transition = 'none'; el.style.transform = ''; el.style.zIndex = ''; el.style.position = ''; }
      // its entrance has been seen; taking the class off must not play it again
      row.style.animation = 'none';
      row.classList.remove('lib-dragging');
      requestAnimationFrame(() => { for (const el of els) el.style.transition = ''; });
    };

    const stop = async () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      cancelAnimationFrame(d.raf);
      document.body.classList.remove('is-dragging-row');
      if (d.to === d.from) { settle(d.units, d.me.row); return; }
      // the dragged row slides into its slot while main renames the files
      const into = d.to > d.from
        ? d.others.slice(d.from, d.to).reduce((n, o) => n + o.span, 0)
        : -d.others.slice(d.to, d.from).reduce((n, o) => n + o.span, 0);
      for (const el of [d.me.row, d.me.tail]) if (el) el.style.transition = 'transform 180ms var(--ease)';
      shift(d.me, into);
      try {
        await drop.current(d.me.row.dataset.row || '', d.to);
      } finally {
        settle(d.units, d.me.row);
      }
    };

    const down = (e: PointerEvent) => {
      const grip = (e.target as Element).closest<HTMLElement>('.lib-grip');
      if (!grip || e.button !== 0 || drag) return;
      const units = measure(list);
      const from = units.findIndex((u) => u.row === grip.closest('.lib-row'));
      if (from === -1) return;
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch { /* a pointer already let go of: the list still hears it */ }
      const me = units[from];
      me.row.classList.add('lib-dragging');
      if (me.tail) Object.assign(me.tail.style, { position: 'relative', zIndex: '5', transition: 'none' });
      document.body.classList.add('is-dragging-row');
      const others = units.filter((u) => u !== me);
      for (const o of others) for (const el of [o.row, o.tail]) if (el) el.style.transition = 'transform 180ms var(--ease)';
      drag = {
        me, units, others, from, to: from,
        clientY: e.clientY, grab: e.clientY - me.row.getBoundingClientRect().top,
        scroller: scrollerOf(list), raf: 0,
      };
      follow();
      drag.raf = requestAnimationFrame(tick);
    };

    const move = (e: PointerEvent) => {
      if (!drag) return;
      drag.clientY = e.clientY;
      follow();
      place();
    };

    list.addEventListener('pointerdown', down);
    list.addEventListener('pointermove', move);
    list.addEventListener('pointerup', stop);
    list.addEventListener('pointercancel', stop);
    return () => {
      list.removeEventListener('pointerdown', down);
      list.removeEventListener('pointermove', move);
      list.removeEventListener('pointerup', stop);
      list.removeEventListener('pointercancel', stop);
    };
  }, [listRef]);
}
