/* The state of the game and the things that shape it: what the app was told from the network,
 * the search-path patch and its repair after a Dota update, the item schema, free cosmetics,
 * mod previews, and the Source 2 toolchain.
 *
 * These are the channels that answer "what is the game like right now" rather than "do this to
 * a mod". Bodies unchanged from main.js.
 */
const { ipcMain } = require('electron');

const { t } = require('./i18n.ts');
const { heroIdFromName } = require('./hero-names.ts');

/** @param {object} ctx  the services and main-process callbacks these channels use */
function registerGameIpc({
  // patchRepair() is read late and written through setPatchRepair: it changes while the app
  // runs, and a value captured at registration would answer for the wrong moment forever.
  blocked, diag, dotaIsRunning, gameIcons, icons, library, modPreviews, remoteConfig,
  repairAfterPatch, schemaService, settings, toolchain, patchRepair, setPatchRepair,
}) {

  // A switch is honoured here rather than in the renderer: this is the boundary an old
  // window, a stale screen or a replayed click all have to come through. `blocked` arrives
  // from src/feature-gate.ts, because the copy that used to live here got left behind when
  // its only other caller moved to another file.
  const uiLang = () => (settings.get('uiLang') === 'ru' ? 'ru' : 'en');

  ipcMain.handle('config:state', () => ({
    features: Object.fromEntries(remoteConfig.SWITCHABLE.map((n) => [n, remoteConfig.feature(n, uiLang())])),
    notices: remoteConfig.notices(uiLang()),
    seen: settings.get('seenNotices') || [],
  }));

  ipcMain.handle('config:noticeSeen', (e, id) => {
    const seen = new Set(settings.get('seenNotices') || []);
    seen.add(String(id));
    // an id list that only grows is a settings file that only grows
    settings.set('seenNotices', [...seen].slice(-50));
    return [...seen];
  });

  ipcMain.handle('patch:state', () => schemaService.state());

  // what the app did about the last Dota patch (the banner in My mods asks on every visit;
  // while the app is open it is pushed instead, see setPatchRepair)
  ipcMain.handle('patch:repairState', () => patchRepair());
  // "I closed the game, do it now" — the same path the retry timer takes
  ipcMain.handle('patch:repairNow', async () => {
    await repairAfterPatch('manual');
    return patchRepair();
  });
  // the banner is news, not a state of the game: once it has been read it goes away
  ipcMain.handle('patch:repairSeen', () => {
    if (patchRepair().state === 'done' || patchRepair().state === 'failed') setPatchRepair({ state: 'idle' });
    return patchRepair();
  });

  // The one moment the app touches files of the game install: gated on an explicit yes,
  // reversible from the same switch, and every original is backed up in userData first.
  ipcMain.handle('patch:setEnabled', async (e, enabled) => {
    // turning it OFF is always allowed: a switch that traps people in the state it broke is
    // worse than the problem it was flipped for
    if (enabled) { const stop = blocked('cosmetics'); if (stop) return stop; }
    if (!settings.get('dotaGamePath')) return { error: t('Путь к Dota 2 не задан') };
    // the game holds gameinfo open while it runs, so writing it would fail half-way
    if (await dotaIsRunning()) return { error: t('Закрой Dota 2 перед изменением файлов игры') };
    try {
      return schemaService.setEnabled(!!enabled);
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('schema:refresh', () => schemaService.refresh());

  // Free cosmetics are generated from the installed game's own schema, so a weather or
  // courier Valve ships later appears in the list without an app update.
  ipcMain.handle('cosmetics:slots', () => schemaService.cosmeticSlots());

  // One picture per tile, so opening a slot with 2000 items costs only what is on screen.
  //
  // A tile asks with a chain of sources, best first ("modart:pak54_dir.vpk|hero:Brewmaster"),
  // and gets back the first one that has a picture. That is how "the mod's own art beats the
  // wiki's portrait of the vanilla hero, but a raw model texture does not" stays written down
  // in one place - renderer/ui/thumb.js, which composes the chain - instead of being spread
  // across three. A plain name is simply a chain of one, which is what the picker sends.
  //
  // Sources: the mod's own files and the game's own pictures when the toolchain is here
  // (exact, offline, no rate limit), the wiki for whatever is left.
  // the item builder's hub: every hero's portrait, out of the installed game
  ipcMain.handle('cosmetics:heroPortraits', async (e, ids) => {
    try {
      return await gameIcons.heroPortraits((Array.isArray(ids) ? ids : []).slice(0, 300));
    } catch (err) {
      diag('hero portraits failed: ' + err.message);
      return {};
    }
  });

  // the catalog's hero grid: the same portraits, asked for by the name the catalog prints
  ipcMain.handle('cosmetics:heroPortraitsByName', async (e, names) => {
    try {
      const list = (Array.isArray(names) ? names : []).slice(0, 300).map(String);
      const idOf = new Map(list.map((n) => [n, heroIdFromName(n)]));
      const got = await gameIcons.heroPortraits([...new Set(idOf.values())].filter(Boolean));
      const out = {};
      for (const [n, id] of idOf) if (got[id]) out[n] = got[id];
      return out;
    } catch (err) {
      diag('hero portraits by name failed: ' + err.message);
      return {};
    }
  });

  ipcMain.handle('cosmetics:icons', async (e, names) => {
    const wanted = (Array.isArray(names) ? names : []).slice(0, 60);
    const chains = new Map(wanted.map((n) => [n, String(n).split('|').filter(Boolean)]));
    const sources = [...new Set([...chains.values()].flat())];

    const isMod = (s) => s.startsWith(modPreviews.VID) || s.startsWith(modPreviews.ART) || s.startsWith(modPreviews.TEX);
    const found = {};
    try {
      Object.assign(found, await modPreviews.getMany(sources.filter(isMod)));
    } catch (err) {
      diag('mod previews failed, falling back to the usual pictures: ' + err.message);
    }
    const forIcons = sources.filter((s) => !isMod(s) && !found[s]);
    if (forIcons.length) {
      let fromGame = {};
      try {
        fromGame = await gameIcons.getMany(forIcons);
      } catch (err) {
        diag('game icons failed, falling back to the wiki: ' + err.message);
      }
      const left = forIcons.filter((n) => !fromGame[n]);
      Object.assign(found, left.length ? await icons.getMany(left) : {}, fromGame);
    }

    const pictures = {};
    for (const [key, chain] of chains) {
      const hit = chain.find((s) => found[s]);
      if (hit) pictures[key] = found[hit];
    }
    // A clip beats everything else a mod can be pictured by, but only the window can open
    // one. So the answer also says where a frame is still worth taking: the tile shows
    // whatever was found meanwhile, and swaps it for the frame when that arrives.
    const decode = new Set();
    for (const [, chain] of chains) {
      const clip = chain.find((s) => s.startsWith(modPreviews.VID));
      if (clip && !found[clip] && modPreviews.hasVideo(clip)) decode.add(clip);
    }
    return { pictures, decode: [...decode] };
  });

  // A mod that replaces a hero's animated portrait carries its own showcase, and a still out
  // of it is the best picture of that mod there is. Decoding video is the window's job - the
  // app is a browser and already has the decoder - so the bytes go there and the frame comes
  // back to be judged and kept. That is why no ffmpeg is downloaded for this.
  ipcMain.handle('preview:video', (e, key) => {
    try {
      const got = modPreviews.videoBytes(String(key || ''));
      return got ? got.bytes : null;
    } catch (err) {
      diag('mod preview video failed: ' + err.message);
      return null;
    }
  });

  ipcMain.handle('preview:frame', (e, key, png) => {
    try {
      return modPreviews.saveFrame(String(key || ''), Buffer.from(png || []));
    } catch (err) {
      diag('mod preview frame failed: ' + err.message);
      return null;
    }
  });

  // ----- the Source 2 toolchain (Settings shows this) -----
  ipcMain.handle('tools:state', () => ({ tools: toolchain.state(), iconCacheBytes: gameIcons.size() + modPreviews.size() }));

  ipcMain.handle('tools:install', async (e, name) => {
    try {
      await toolchain.ensure(String(name || 'vrf'));
      return { ok: true, tools: toolchain.state() };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('tools:remove', (e, name) => {
    toolchain.remove(String(name || 'vrf'));
    // the pictures it produced are only reachable through it
    gameIcons.clear();
    modPreviews.clear();
    return { ok: true, tools: toolchain.state() };
  });

  // A pick is a library record like any other mod: mods:setEnabled/mods:remove already
  // handle it (see touchesSchema above), this is only for the initial choice.
  ipcMain.handle('cosmetics:pick', (e, slot, itemId, itemName, effectId) => {
    const stop = blocked('cosmetics');
    if (stop) return stop;
    try {
      const rec = schemaService.pickCosmetic(slot, itemId, itemName, effectId);
      return { ok: true, record: rec };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  // A whole set, one write to the game for all its pieces (schema-service pickSet).
  ipcMain.handle('cosmetics:pickSet', (e, setId) => {
    const stop = blocked('cosmetics');
    if (stop) return stop;
    try {
      return { ok: true, ...schemaService.pickSet(setId) };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });
}

module.exports = { registerGameIpc };
