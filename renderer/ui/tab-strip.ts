/* The titlebar's tab strip: it runs out of room on a small window or a high UI scale, and then
 * it scrolls (sideways with the wheel, or by grabbing and swiping it like a strip on a phone),
 * and the bar gives up its smaller parts before the tabs. Split out of chrome.ts, which keeps
 * the window's sizes and zooms. */

// The tab strip runs out of room on a small window or a high UI scale, and then it scrolls:
// sideways with the wheel, or by grabbing and swiping it like a strip on a phone.
export function syncNavOverflow(): void {
  const nav = document.querySelector<HTMLElement>('#tbNav');
  if (nav) nav.classList.toggle('scrollable', nav.scrollWidth > nav.clientWidth + 1);
}

export function bindNavScroll(): void {
  const nav = document.querySelector<HTMLElement>('#tbNav');
  if (!nav) return;
  new ResizeObserver(syncNavOverflow).observe(nav);
  syncNavOverflow();

  // the bar drops the wordmark when it gets cramped — measured on the bar itself, since its
  // own zoom decides how much room it really has
  const tb = document.querySelector<HTMLElement>('#titlebar');
  if (tb) {
    // Measured, not guessed from the width: the tabs come first, then the name, so the bar gives
    // up the "Dota 2" pill, then the search's width, and the name only when nothing else is
    // left. The name stays on screen otherwise, so a screenshot says which program it is.
    const nav = document.querySelector<HTMLElement>('#tbNav');
    const crowded = () => !!nav && nav.scrollWidth > nav.clientWidth + 1;
    const syncWidth = () => {
      tb.classList.remove('narrow', 'tight', 'tiny');
      for (const step of ['narrow', 'tight', 'tiny']) {
        if (!crowded()) break;
        tb.classList.add(step);
      }
      syncNavOverflow();
    };
    // a frame later: the classes change the sizes being watched, and a change inside the
    // callback is a loop the browser stops and reports
    let queued = 0;
    const watch = new ResizeObserver(() => { cancelAnimationFrame(queued); queued = requestAnimationFrame(syncWidth); });
    watch.observe(tb);
    // a tab's word changes with the language and the bar's width does not
    document.querySelectorAll('#tbNav .tb-tab').forEach((t) => watch.observe(t));
    syncWidth();
  }

  nav.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // that gesture belongs to the panel size
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta || nav.scrollWidth <= nav.clientWidth) return;
    e.preventDefault();
    nav.scrollLeft += delta;
  }, { passive: false });

  let drag: { id: number; x: number; left: number; moved: boolean } | null = null;
  let swallowClick = false;
  nav.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || nav.scrollWidth <= nav.clientWidth) return;
    drag = { id: e.pointerId, x: e.clientX, left: nav.scrollLeft, moved: false };
  });
  // on the window: a swipe often runs past the strip, and it must keep scrolling anyway
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 4) return; // still a click, not a swipe
      drag.moved = true;
      nav.classList.add('dragging');
    }
    nav.scrollLeft = drag.left - dx;
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) swallowClick = true; // a swipe must not also switch the view
    nav.classList.remove('dragging');
    drag = null;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  nav.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
