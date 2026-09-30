/* Everything the Settings screen is told, in one answer.
 *
 * Both settings handlers return this, and that is the point. `settings:set` used to answer
 * with the bare store, and the renderer caches whatever it is handed - so saving any single
 * setting quietly dropped `dotaPathValid` from the screen's copy. Favouriting a mod was
 * enough: from the next repaint the catalog claimed Dota was not installed and every install
 * refused with "set the path first", until the app was restarted. The values were all correct;
 * only the screen's idea of them was not.
 *
 * It is a module because it is the largest single computation in the main process - the game
 * path, the language folder the game will really mount, whose mods those are, what Minify is
 * doing and what is stranded outside the folder - and none of that is about starting a window.
 */
const fs = require('fs');
const path = require('path');

const gamelang = require('./gamelang.ts');
const { readMinify, isMinifyFile, isMinifyPak } = require('./minify.ts');

/**
 * @param {object} deps
 * @param {object} deps.settings
 * @param {object} deps.library
 * @param {object} deps.discordAuth
 * @param {(p: string) => boolean} deps.validateGamePath
 * @param {() => string} deps.langFolder     read late: the app can move folders while running
 * @param {() => object|null} deps.takeMigration  the one-shot news about a folder move, or null
 * @param {() => object|null} [deps.takeSlotMigration]  the one-shot news about the load order being laid out, or null
 * @returns {(opts?: { consumeMigration?: boolean }) => object}
 */
function settingsViewFor({ settings, library, discordAuth, validateGamePath, langFolder, takeMigration, takeSlotMigration = () => null }) {
  // ----- settings -----
  /**
   * What the renderer means by "settings": the stored values plus the few facts about this
   * machine that only the main process can answer.
   *
   * Both handlers return this, and that is the point. `settings:set` used to answer with the
   * bare store, and the renderer caches whatever it is handed - so saving any single setting
   * quietly dropped `dotaPathValid` from the screen's copy. Favouriting a mod was enough:
   * from the next repaint the catalog claimed Dota was not installed and every install
   * refused with "set the path first", until the app was restarted. The values were all
   * correct; only the screen's idea of them was not.
   */
  return ({ consumeMigration = false } = {}) => {
    const game = settings.get('dotaGamePath');
    const folders = gamelang.langFolders(game);
    // Whose mods the game is actually going to read. Both managers name a language folder and
    // Dota mounts exactly one, so this is a question with a definite answer - see src/minify.ts.
    const lang = game ? gamelang.detectLangSuffix(game) : { suffix: null, source: null, uiLanguage: null, audio: null };
    /* How many of the files in its folder are its own. Once both apps share one folder,
     * counting everything there would report our mods as Minify's - and the answer has to be
     * a fact about who wrote what, which is what the marker is for. */
    const minifyModsIn = (suffix) => {
      if (!suffix || !game) return 0;
      try {
        const dir = path.join(game, `dota_${suffix}`);
        return fs.readdirSync(dir).filter((f) => {
          const low = f.toLowerCase();
          if (!/_dir\.vpk(\.off|\.moff)?$/.test(low)) return false;
          return isMinifyFile(low) || isMinifyPak(path.join(dir, f));
        }).length;
      } catch {
        return 0;
      }
    };
    const minify = readMinify({
      folders,
      audio: lang.audio,
      gameLanguages: gamelang.DOTA_LANGUAGES,
      countMods: minifyModsIn,
      ourFolder: langFolder(),
      ourMods: library.list().filter((r) => (r.files || []).some((f) => f.root === 'lang')).length,
      // the whole launch line, not just its language: Minify's newer releases put a command of
      // their own in front of the game there, and that is worth being able to name
      launchOptions: game ? gamelang.launchOptions(game) : null,
    });
    // Only the screen asking for settings gets to hear about the migration, and only once.
    // A save must not swallow the news before anybody has read it.
    const migrated = consumeMigration ? takeMigration() : null;
    const slotsLaidOut = consumeMigration ? takeSlotMigration() : null;
    return {
      ...settings.all(),
      dotaPathValid: validateGamePath(game),
      minify,
      discordConfigured: discordAuth.isConfigured(),
      // What is left of the language question, now that the folder is always dota_russian:
      // whether the game agrees, and whether any mods are stranded outside it. Both are
      // things to tell the user about, not things to ask them.
      gameLang: {
        mounted: lang.suffix,
        /* A -language in Steam's launch options locks both language settings and decides the
         * folder, so it overrules everything this app sets. Reported whatever its value,
         * because even one that agrees with us today takes the choice of text language away
         * from the player and breaks the moment either side changes. */
        launchLang: lang.source === 'launch' ? lang.audio : null,
        folder: langFolder(),
        /* Mods sitting in a folder the game does not mount - ours, left behind by a language
         * change. Never another tool's: the screen offers to move these into our folder, and
         * taking Minify's compiled pak out of the folder it just built it in would break its
         * install to fix nothing. Its files are its business, and where they are is a thing
         * to explain rather than to correct (see src/minify.ts). */
        stranded: folders
          .filter((f) => f.suffix !== langFolder() && f.modFiles > 0 && f.suffix !== minify.folder)
          .map((f) => ({ suffix: f.suffix, modFiles: f.modFiles })),
      },
      langMigration: migrated,
      slotMigration: slotsLaidOut,
    };
  };
}

module.exports = { settingsViewFor };
