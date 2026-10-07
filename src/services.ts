/* What the app is built from: every long-lived service, created once in the order they depend on
 * each other. src/main.ts calls this when the app is ready, then puts the game folder right and
 * hands the services to the IPC modules.
 *
 * Two things start in the background here and are not waited for: the fingerprint list and the
 * remote config. Both answer from their cached copies until the network does.
 */
import path from 'node:path';
import { Settings } from './settings.ts';
import { Catalog } from './catalog.ts';
import { Installer } from './installer.ts';
import * as importer from './import.ts';
import { createCursors } from './cursors.ts';
import { createAdopt, type ImportResult } from './adopt.ts';
import { Library } from './library.ts';
import { Fingerprints } from './fingerprints.ts';
import * as discordAuth from './discord-auth.ts';
import { DiscordPresence } from './discord-presence.ts';
import { createSchemaService } from './schema-service.ts';
import { createUpdateImpact, impactMods } from './update-impact.ts';
import { clientVersion } from './patch-watch.ts';
import { createRemoteConfig } from './remote-config.ts';
// the download chain, so a mirror named in that signed file joins it
import { applyMirrors } from './net.ts';
import { createToolchain } from './toolchain.ts';
import { createGameIcons } from './game-icons.ts';
import { createModPreviews } from './mod-preview.ts';
import { createModIdentity } from './mod-id.ts';
import { Icons } from './icons.ts';
import { presetsService } from './presets-service.ts';
import { createPresenceStatus } from './presence-status.ts';
import { setLang, t } from './i18n.ts';
import { errorText } from './error-text.ts';
import type { AppContext, AppProgress } from './app-context.ts';
import type { LibRecord } from './types.ts';

/** Build every service over this userData folder. */
export function createServices({ userData, appVersion, sendProgress, diag, fetchIcons }: {
  userData: string;
  appVersion: () => string;
  /** the bar at the bottom of the window */
  sendProgress: (evt: AppProgress) => void;
  diag: (msg: string) => void;
  /** Electron's network stack, which the wiki's pictures come through (see src/icons.ts) */
  fetchIcons: ConstructorParameters<typeof Icons>[1];
}) {
  const settings = new Settings(userData);
  setLang(settings.get('uiLang'));
  const catalog = new Catalog(userData);
  const library = new Library(userData);
  const fingerprints = new Fingerprints(userData);
  void fingerprints.refresh(); // fire-and-forget: pull the latest fp -> mod map
  const modId = createModIdentity({ getGamePath: () => settings.get('dotaGamePath'), log: diag });
  const installer = new Installer({
    userDataDir: userData,
    getGamePath: () => settings.get('dotaGamePath'),
    getLangSuffix: () => settings.get('langSuffix'),
    onProgress: sendProgress,
    identify: (paths) => modId.identify(paths),
    publishedHash: (categoryId, file) => catalog.publishedHash(categoryId, file),
    log: diag,
  });
  const presence = new DiscordPresence({ clientId: discordAuth.CLIENT_ID, onDiag: diag });
  const presenceStatus = createPresenceStatus({ presence, settings, library, installer });
  const schemaService = createSchemaService({ settings, library, installer, userDataDir: userData, log: diag });
  // which installed mods a Dota update reached (src/update-impact.ts)
  const updateImpact = createUpdateImpact({
    file: path.join(userData, 'update-impact.json'),
    gamePath: () => settings.get('dotaGamePath'),
    mods: () => impactMods(library.list(), (rel) => installer.langFileOnDisk(rel)),
    build: clientVersion,
    log: diag,
  });
  const cursors = createCursors({ installer, library, settings });
  const adopt = createAdopt({ installer, library, schemaService });
  // what the app can be told after it shipped: a feature switched off with a reason, and dated
  // notices. Fire-and-forget, and everything it governs stays on until it says otherwise
  const remoteConfig = createRemoteConfig({ userDataDir: userData, appVersion, log: diag });
  /* The cached file is read before the fetch answers, so a second copy of the catalog arranged
     after this build shipped is in the chain from the first download rather than the second run. */
  applyMirrors(remoteConfig.mirrors());
  void remoteConfig.refresh().then(() => applyMirrors(remoteConfig.mirrors()));
  // pictures for the cosmetics picker come through Electron's network stack (see src/icons.ts)
  const icons = new Icons(userData, fetchIcons);
  // ...unless the Source 2 toolchain is here, in which case they come out of the game itself
  const toolchain = createToolchain({ userDataDir: userData, onProgress: sendProgress, log: diag });
  const gameIcons = createGameIcons({ userDataDir: userData, toolchain, getGamePath: () => settings.get('dotaGamePath'), log: diag });
  // ...and the same toolchain gives a mod that came with no picture one out of itself
  const modPreviews = createModPreviews({ userDataDir: userData, toolchain, langFileOf: (relPath) => installer.langFileOnDisk(relPath), log: diag });

  // after any deploy, if the master switch is off, sweep freshly written files off too
  const afterDeployMaster = () => {
    try { if (installer.masterIsOff()) installer.setMasterEnabled(false); } catch { /* noop */ }
  };
  // rebuild a pack's deployed VPK, persist its files, and re-apply pack + master off-state
  const deployAndApply = (pack: LibRecord) => {
    const { files, conflicts } = installer.deployPack(pack);
    library.update(pack.id, { files, members: pack.members });
    if (pack.enabled === false && files.length) { try { installer.setEnabled(files, false); } catch { /* noop */ } }
    afterDeployMaster();
    return conflicts;
  };
  const presets = presetsService({ catalog, installer, library, schemaService, deployAndApply });

  // Two counted passes over the same batch: the files land, then each one is read. Both are shown
  // on the one bar, so a long import says which mod it is on instead of nothing at all. The two
  // ways in differ only in which importer reads them, so they share the bar, the error and the
  // "done" that has to arrive whichever way it ends.
  const step = (label: string) => (done: number, total: number) => sendProgress({ type: 'count', label, done, total });
  const runImport = async (take: (onStep: (done: number, total: number) => void) => Promise<ImportResult[]>) => {
    try {
      return await adopt.registerImportResults(await take(step(t('Копирование модов'))), step(t('Разбор модов')));
    } catch (err) {
      return { error: errorText(err) };
    } finally {
      sendProgress({ type: 'done' });
    }
  };
  const importVpkPaths: AppContext['importVpkPaths'] = (paths) => runImport((onStep) => importer.importVpks(installer, Array.isArray(paths) ? paths : [], onStep));
  // from raw bytes: the drag-and-drop fallback for when a real path cannot be resolved
  const importVpkBuffers: AppContext['importVpkBuffers'] = (items) => runImport((onStep) => importer.importVpkBuffers(installer, Array.isArray(items) ? items : [], onStep));

  return {
    settings, catalog, library, fingerprints, installer, presenceStatus, schemaService, updateImpact, cursors, adopt,
    remoteConfig, icons, toolchain, gameIcons, modPreviews,
    afterDeployMaster, deployAndApply, presets, importVpkPaths, importVpkBuffers,
  };
}
