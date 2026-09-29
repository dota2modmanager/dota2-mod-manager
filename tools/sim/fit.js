/**
 * Whether a window fits the work area it opened in (Sim.windowFits in driver.js), out of the driver
 * so the rule can be tested without Electron.
 *
 * A profile simulates 125% or 150% by forcing the scale factor (--force-device-scale-factor, see
 * run.mjs) on whatever screen the machine has, usually one at 96 DPI. Electron converts sizes on
 * such a pair with a rounding of its own: a window asked for 1093x582 came back 1096x585 on a 96 DPI
 * screen forced to 1.25 (measured 2026-09-28, the same for a framed window and a frameless one), and
 * 1022x583 on the Windows runner, whose narrower screen also clamps the width. At 100% it came back
 * exactly as asked, and so does a real 125% screen, where nothing is forced. The slack is that
 * rounding and no more: the regression this check exists for was a window 58 px taller than the
 * screen (a minimum height of 640 on a 582 work area).
 */
const FORCED_SCALE_SLACK = 4;

/**
 * @param {{ width: number, height: number }} win   the window's bounds
 * @param {{ width: number, height: number }} area  the work area it opened in
 * @param {{ forcedScale?: boolean }} [opts]         the scale factor was forced on the command line
 */
function fitsWorkArea(win, area, { forcedScale = false } = {}) {
  const slack = forcedScale ? FORCED_SCALE_SLACK : 0;
  return win.width <= area.width + slack && win.height <= area.height + slack;
}

module.exports = { fitsWorkArea, FORCED_SCALE_SLACK };
