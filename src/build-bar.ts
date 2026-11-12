/* The bar at the bottom of the window while the item table builds in the background
 * (src/schema-build.ts builds it, src/schema-service.ts runs it). */
import type { BuildStep } from './schema-build.ts';

/**
 * The bar at the bottom of the window for a build in the background: shown once the build has run
 * for `after` ms, so a pick that takes a fifth of a second does not flash it, and counted in the
 * picks built anew, with Cancel on it (src/build-undo.ts). A build with none to build, the merge
 * and the write alone, shows nothing.
 */
export function buildBar(send: (evt: { type: 'count'; label: string; done: number; total: number; cancel?: 'schema' } | { type: 'done' }) => void,
  label: () => string, after = 400, now = () => Date.now()): (step: BuildStep | null) => void {
  let started: number | null = null;
  let shown = false;
  let picks = { done: 0, total: 0 };
  return (step) => {
    if (!step) {
      if (shown) send({ type: 'done' });
      started = null;
      shown = false;
      picks = { done: 0, total: 0 };
      return;
    }
    started ??= now();
    // the stages of the write come after every pick: the count stays full while they run
    picks = 'total' in step ? step : { done: picks.total, total: picks.total };
    if (!picks.total || (!shown && now() - started < after)) return;
    shown = true;
    send({ type: 'count', label: label(), ...picks, cancel: 'schema' });
  };
}
