/* Showing a person where a thing is once they are taken to it: a Workshop tile that sends them to a
 * switch in Settings or a button in a hero's window waits for it to be drawn, scrolls it into the
 * middle and rings it for a moment (.spotlit, styles/controls.css). */

/** Asks `find` every frame until it answers or `ms` pass. */
export function waitFor<T>(find: () => T | null | undefined, ms = 4000): Promise<T | null> {
  const until = performance.now() + ms;
  return new Promise((resolve) => {
    const look = () => {
      const got = find();
      if (got) resolve(got);
      else if (performance.now() > until) resolve(null);
      else requestAnimationFrame(look);
    };
    look();
  });
}

/** The element `selector` finds, once it is there, scrolled into view and ringed; false when it never came. */
export async function spotlight(selector: string, ms = 4000): Promise<boolean> {
  const el = await waitFor(() => document.querySelector<HTMLElement>(selector), ms);
  if (!el) return false;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  el.classList.remove('spotlit');
  void el.offsetWidth; // a second visit rings it again
  el.classList.add('spotlit');
  setTimeout(() => el.classList.remove('spotlit'), 3100);
  return true;
}
