/* A crash the user cannot explain is the hardest kind to fix from a support chat. Both kinds land in
 * the app's own log (diag:rendererError in crates/mm-core/src/owner/owner_support.rs), so "it broke" turns into a
 * report the user can export instead of a guessing game over Discord. */
window.addEventListener('error', (e) => {
  window.api.diag.reportError(`window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  window.api.diag.reportError(`unhandledrejection: ${e.reason?.stack || e.reason}`);
});
