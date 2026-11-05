/**
 * How fast the real map runs, for the bench's --fps. The hero demo stands on a small map of its own,
 * so what a mod does to the frame rate on the real one takes a match: a private lobby, paused, with
 * the camera put on each spot in turn. The figure is the game's own: cl_resetfps, then cl_printfps,
 * which the game's cfg/perftest.cfg uses and which needs a lobby with cheats on.
 *
 * Measured 2026-11-06 on an RTX 4060 at 1080p: the same build came back within 1-2% round after
 * round. That machine stands at 280-330 FPS with the processor as the limit, so a mod that costs the
 * graphics card shows up less there than on a weaker one; a second pass held at 60 FPS reads how
 * busy the card is, as its load times its clock, since it slows its clock down when it has time.
 */

/** Spots of the map: world x, y, for dota_camera_set_lookatpos. Grass, forest, water, a base. */
export const SPOTS = {
  mid: [0, 0], rad_jungle: [-1500, -4000], rad_forest: [-4500, -1500], dire_jungle: [2500, 3500],
  river_top: [-3000, 3000], river_bot: [3500, -3500], rad_base: [-6500, -6000],
};

/** What cl_printfps wrote: the average over the last 1000 frames, or null. */
export function readFps(log) {
  const lines = log.split('\n').filter((l) => /\b1000 frames\b/.test(l));
  const fps = Number(/([\d.]+) fps/.exec(lines.at(-1) ?? '')?.[1]);
  return fps > 0 ? fps : null;
}

/** One nvidia-smi line, "load, clock", as the card's busy figure, or null. */
export function readBusy(line) {
  const [load, clock] = String(line).split(',').map(Number);
  return load >= 0 && clock > 0 ? load * clock / 1000 : null;
}

/** The mean of what could be read, rounded, or null. */
export function mean(values) {
  const v = values.filter((n) => Number.isFinite(n));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
}

/** Each spot of one run against another: the percent it gained, negative when it lost. */
export function fpsChange(run, against) {
  const out = {};
  for (const [spot, m] of Object.entries(run)) {
    const was = against[spot];
    const change = (key) => (m[key] && was?.[key] ? Math.round((m[key] / was[key] - 1) * 1000) / 10 : null);
    out[spot] = { fps: change('fps'), busy: change('busy') };
  }
  return out;
}
