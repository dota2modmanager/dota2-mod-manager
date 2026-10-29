/* What the app is built from: every long-lived service, created once in the order they depend on
 * each other. src/main.ts calls this when the app is ready, then puts the game folder right and
 * hands the services to the IPC modules.
 *
 * Two things start in the background here and are not waited for: the fingerprint list and the
 * remote config. Both answer from their cached copies until the network does. A third waits for
 * the start to settle: on Linux, a copy of the Workshop Tools the game has (src/workshop-tools.ts).
 */
import path from 'node:path';
import { Settings } from './settings.ts';
import { beginNightAgain } from './pumpkin.ts';
import { Catalog } from './catalog.ts';
import { Installer } from './installer.ts';
import * as importer from './import.ts';
import { createCursors } from './cursors.ts';
import { createAdopt, type ImportResult } from './adopt.ts';
import { Library } from './library.ts';
import { FileTx } from './file-tx.ts';
import { recoverJournals } from './file-tx-journal.ts';
import { Fingerprints } from './fingerprints.ts';
import * as discordAuth from './discord-auth.ts';
import { DiscordPresence } from './discord-presence.ts';
import { buildBar, builderStamp, createSchemaService } from './schema-service.ts';
import { createUpdateImpact, impactMods } from './update-impact.ts';
import { createArcanaService, type Generated } from './arcana-service.ts';
import { createBaseStore } from './arcana-base-store.ts';
import { TERRORBLADE_BASE } from './arcana-bases.ts';
import { clientVersion } from './patch-watch.ts';
import { createRemoteConfig } from './remote-config.ts';
// the download chain, so a mirror named in that signed file joins it
import { applyMirrors, setDownloadProxy } from './net.ts';
import { createToolchain } from './toolchain.ts';
import { createResourceCompiler } from './resource-compiler.ts';
import { createToolsKeeper } from './workshop-tools.ts';
import { createGameIcons } from './game-icons.ts';
import { createModPreviews } from './mod-preview.ts';
import { createModIdentity } from './mod-id.ts';
import { Icons } from './icons.ts';
import { presetsService } from './presets-service.ts';
import { createPresenceStatus } from './presence-status.ts';
import { catalogModsReader, createDownloadStats, statKeysFor } from './download-stats.ts';
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
  // Before anything reads the library or touches the game folder: a change the last process
  // died in the middle of is finished or undone first, so what loads next is one whole state.
  FileTx.journalDir = path.join(userData, 'tx');
  const recovered = recoverJournals(FileTx.journalDir, diag);
  if (recovered.undone || recovered.finished) diag(`tx recovery: undid ${recovered.undone}, finished ${recovered.finished}`);
  const settings = new Settings(userData);
  // a new round of the bloody night starts everybody from the beginning, once (src/pumpkin.ts)
  if (beginNightAgain({ get: (k) => settings.get(k as never), set: (k, v) => settings.set(k as never, v as never) })) diag('the night starts again');
  setDownloadProxy(settings.get('downloadProxy'));
  setLang(settings.get('uiLang'));
  const catalog = new Catalog(userData);
  const library = new Library(userData);
  const downloadStats = createDownloadStats({
    cacheFile: path.join(userData, 'download-counts.json'),
    enabled: () => settings.get('countDownloads') !== false,
    log: diag,
  });
  const catalogMods = catalogModsReader(catalog.cachePath('mods.json'));
  /** one install of a catalog mod, for the counter; never throws */
  const countInstall = (categoryId: string, name: string, styleLabel?: string | null) => {
    try { downloadStats.track(statKeysFor(catalogMods(), categoryId, name, styleLabel)); } catch { /* counting is never worth an install */ }
  };
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
  /* The arcana bases (src/arcana-bases.ts): asked for by the build that needs one, which goes on
     from the game's files meanwhile, and built again with it once it is here: the builder's table,
     and the arcana window's Terrorblade if it was built whole from Valve's files. */
  const bases = createBaseStore({
    dir: path.join(userData, 'arcana-bases'),
    log: diag,
    onReady: (id) => {
      void schemaService.refreshInBackground();
      if (id !== TERRORBLADE_BASE) return;
      // after the table, not on top of it: each is a stretch of the thread the window draws on
      void schemaService.settled().then(() => arcana.rebuild(library.list().filter((r) => (r.generated as Generated | undefined)?.mode === 'mod').map((r) => r.id)));
    },
  });
  // the item table built in the background says how far it is on the bar at the bottom
  const onBuild = buildBar(sendProgress, () => t('Сборка предметов'));
  // the arcana window's Terrorblade leaves the paths the builder's picks fill to them
  const schemaService = createSchemaService({ settings, library, installer, userDataDir: userData, log: diag, bases, onBuild,
    onDeployed: (filled) => arcana.giveWay(filled) });
  // which installed mods a Dota update reached (src/update-impact.ts)
  const updateImpact = createUpdateImpact({
    file: path.join(userData, 'update-impact.json'),
    gamePath: () => settings.get('dotaGamePath'),
    mods: () => impactMods(library.list(), (rel) => installer.langFileOnDisk(rel)),
    build: clientVersion,
    log: diag,
  });
  // the arcana built out of the game's own files, in a colour of the user's (src/arcana.ts)
  const arcana = createArcanaService({ gamePath: () => settings.get('dotaGamePath'), installer, library, log: diag, bases, code: builderStamp });
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
  /* Valve's compiler from the Workshop Tools, found in the game or picked in Settings, under Wine
     on Linux (src/resource-compiler.ts). On Linux the tools leave with the Proton build, so a copy
     is kept once they have been seen (src/workshop-tools.ts); Windows keeps its tools. */
  const keepLabel = () => t('Копия Workshop Tools');
  const toolsKeeper = process.platform === 'win32' ? null : createToolsKeeper({
    dir: path.join(userData, 'workshop-tools'), gamePath: () => settings.get('dotaGamePath'), log: diag,
    onStep: (done, total) => sendProgress({ type: 'count', label: keepLabel(), done, total }),
  });
  const compiler = createResourceCompiler({ userDataDir: userData, gamePath: () => settings.get('dotaGamePath'),
    chosen: () => settings.get('resourceCompilerPath'), keeper: toolsKeeper || undefined, log: diag });
  const keepTools: AppContext['keepTools'] = async ({ force = false } = {}) => {
    if (!toolsKeeper) return false;
    try {
      const copied = await toolsKeeper.keep({ force });
      if (copied) sendProgress({ type: 'done', label: keepLabel() });
      return copied;
    } catch (err) {
      diag(`workshop tools: no copy kept: ${errorText(err)}`);
      sendProgress({ type: 'error', label: keepLabel(), message: errorText(err) });
      throw err;
    }
  };
  // after the start has settled: 700 MB read while the window draws its first screens is felt
  setTimeout(() => { keepTools().catch(() => {}); }, 15000).unref();

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
    remoteConfig, icons, toolchain, compiler, toolsKeeper, keepTools, gameIcons, modPreviews, arcana,
    afterDeployMaster, deployAndApply, presets, importVpkPaths, importVpkBuffers, downloadStats, countInstall,
  };
}
