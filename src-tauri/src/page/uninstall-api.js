/* The bridge for the window the uninstaller opens, and nothing else.
 *
 * The main window's api (api.js) hands the renderer everything: installing mods, running tools,
 * writing into the game folder. That window is ours and lives for as long as the app does.
 * This one exists for a few seconds while the app is being removed, so it gets the four
 * calls it needs and no way to reach the rest.
 */
(function () {
  const mm = window.__mm;

  window.uninstall = {
    /** What there is to remove: how many mods, whether the game is patched, how much data. */
    plan: () => mm.invoke('uninstall:plan'),
    /** Do it. `{ revert, mods, data }` - each one exactly what the checkbox said. */
    run: (choices) => mm.invoke('uninstall:run', choices),
    /** Finished: let the uninstaller carry on. `wipeData` asks it to take the app's folder too. */
    done: (wipeData) => mm.invoke('uninstall:done', !!wipeData),
    /** Changed their mind: the program stays and nothing at all is removed. */
    cancel: () => mm.invoke('uninstall:cancel'),
  };
})();
