/* A long list drawn a page at a time, the next page as the end of the last one comes near (issue #358).
 *
 * Heroes is over six hundred cards and a big library as many rows, and every one of them was in
 * the page from the moment the list opened: six hundred pictures asked for, six hundred cards for
 * React to compare on every chip, star and install, for a window that shows about fifteen. Now a
 * list holds the first pages and a marker after them; when the marker comes within a couple of
 * screens of the visible part, the next page joins. Scrolling reads as one list, and nothing in
 * the list's order or its count changes: the marker carries the whole length (data-total), which
 * is what the simulation counts by.
 *
 * The marker is outside the scroll's way: no height, no box anybody can point at. With nothing
 * left to add it is gone.
 */
import { createElement, startTransition, useEffect, useRef, useState, type RefObject } from 'react';

/** What a page holds: a few screens of the smallest cards on a large window. */
export const PAGE = 120;
/** How far ahead of the visible part the next page is fetched, so a fast scroll never hits the end. */
const AHEAD = '1600px 0px';

/**
 * How many of `total` to draw, and the marker to put after them.
 * @param resetKey  a different list (another category, another search): back to the first page
 */
export function useGrowing(total: number, resetKey: unknown): { limit: number; marker: RefObject<HTMLDivElement | null>; more: boolean } {
  const [limit, setLimit] = useState(PAGE);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) { setKey(resetKey); setLimit(PAGE); }
  const marker = useRef<HTMLDivElement | null>(null);
  const more = total > limit;

  useEffect(() => {
    const el = marker.current;
    if (!more || !el || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      // a transition: the page joins across frames rather than in one long task
      startTransition(() => setLimit((n) => Math.min(total, n + PAGE)));
    }, { rootMargin: AHEAD });
    seen.observe(el);
    return () => seen.disconnect();
  }, [more, total, limit]);

  return { limit: Math.min(limit, total), marker, more };
}

/** The marker itself: the place the next page goes, with the list's whole length on it. */
export function GrowMarker({ marker, total, className }: { marker: RefObject<HTMLDivElement | null>; total: number; className: string }) {
  return createElement('div', { ref: marker, className, 'data-total': total, 'aria-hidden': 'true' });
}
