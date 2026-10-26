/**
 * The page code Sim.until runs (driver.js), out of the driver so it can be tested without Electron.
 *
 * An expression polled with until is often a lookup, `document.querySelector('.rail-item')`, whose
 * answer is a DOM element. Electron 44 cloned an element out of executeJavaScript as `{}`.
 * Electron 45 clones it as it is, and React hangs its fiber on every element it draws
 * (`__reactFiber$…`, functions inside), so every scenario stopped in its first wait with
 * "An object could not be cloned." The page clones the answer itself first: one that clones
 * comes back as it is, one that does not comes back as whether it was there, which is all a
 * wait on an element asks.
 */

/** @param {string} expr an expression in the page, awaited, so it can be a call into window.api */
function awaited(expr) {
  return `(async () => {
    let v;
    try { v = await (${expr}); } catch { return null; }
    try { return structuredClone(v); } catch { return Boolean(v); }
  })()`;
}

module.exports = { awaited };
