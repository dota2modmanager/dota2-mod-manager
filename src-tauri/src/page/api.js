/* window.api: every call the window makes to the app, by name, over the bridge (bridge.js) as one
 * channel each. renderer/api/ types it for the window's TypeScript. */
(function () {
  const mm = window.__mm;

  // The big pieces of a 3D preview answer come in slices (crates/mm-core/src/owner/large_answer.rs), and go back in their places.
  async function wholeAnswer(value) {
    if (Array.isArray(value)) return Promise.all(value.map(wholeAnswer));
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return value;
    if (value.$large === undefined) {
      const out = {};
      for (const key of Object.keys(value)) out[key] = await wholeAnswer(value[key]);
      return out;
    }
    const bytes = new Uint8Array(value.size);
    for (let at = 0; at < value.size;) {
      const slice = await mm.invoke('preview3d:slice', value.$large, at);
      if (!slice?.byteLength) throw new Error('3D preview: a piece of the answer was lost');
      bytes.set(slice, at);
      at += slice.byteLength;
    }
    return value.text ? new TextDecoder().decode(bytes) : bytes;
  }

  window.api = {
    win: {
      minimize: () => mm.invoke('win:minimize'),
      maximize: () => mm.invoke('win:maximize'),
      close: () => mm.invoke('win:close'),
      isMaximized: () => mm.invoke('win:isMaximized'),
      onMaximized: (cb) => mm.on('win:maximized', cb),
    },
    settings: {
      get: () => mm.invoke('settings:get'),
      set: (key, value) => mm.invoke('settings:set', key, value),
      detectDota: () => mm.invoke('settings:detectDota'),
      browseDota: () => mm.invoke('settings:browseDota'),
      moveLangFiles: (fromSuffix) => mm.invoke('settings:moveLangFiles', fromSuffix),
      testProxy: (proxy) => mm.invoke('settings:testProxy', proxy),
    },
    ui: {
      setZoom: (factor) => mm.invoke('ui:setZoom', factor),
      onZoom: (cb) => mm.on('ui:zoom', cb),
    },
    catalog: {
      load: (force) => mm.invoke('catalog:load', force),
      terrainAges: () => mm.invoke('catalog:terrainAges'),
      downloadCounts: () => mm.invoke('catalog:downloadCounts'),
      // a d2mm://mod/ link clicked outside the app (crates/mm-core/src/catalog/deep_links.rs)
      onModLink: (cb) => mm.on('mod-link', cb),
    },
    mods: {
      install: (payload) => mm.invoke('mods:install', payload),
      list: () => mm.invoke('mods:list'),
      switchOffStaleTerrains: () => mm.invoke('mods:switchOffStaleTerrains'),
      setEnabled: (id, enabled) => mm.invoke('mods:setEnabled', id, enabled),
      remove: (id) => mm.invoke('mods:remove', id),
      // a selection at once: one rebuild of the item schema for the batch, not one per mod
      removeMany: (ids) => mm.invoke('mods:removeMany', ids),
      // Settings: every mod out and the game's own files back, the app stays
      removeEverything: () => mm.invoke('mods:removeEverything'),
      // who owns the map archive a terrain is about to replace (maps/dota.vpk is one file)
      mapsOwner: () => mm.invoke('mods:mapsOwner'),
      setEnabledMany: (ids, enabled) => mm.invoke('mods:setEnabledMany', ids, enabled),
      move: (id, dir) => mm.invoke('mods:move', id, dir),
      reorder: (id, toIndex) => mm.invoke('mods:reorder', id, toIndex),
      externalSetEnabled: (fileName, enabled) => mm.invoke('mods:externalSetEnabled', fileName, enabled),
      externalRemove: (fileName) => mm.invoke('mods:externalRemove', fileName),
      exportSingle: (id) => mm.invoke('mods:exportSingle', id),
      unpackToFolder: (id) => mm.invoke('mods:unpackToFolder', id),
      // the pre-patch mark off one mod, once its owner checked it in the game
      clearPrePatch: (id) => mm.invoke('mods:clearPrePatch', id),
      // a catalog mod brought to the catalog's current version, in its own slot
      update: (id) => mm.invoke('mods:update', id),
      importDialog: () => mm.invoke('mods:importDialog'),
      importFolderDialog: () => mm.invoke('mods:importFolderDialog'),
      importPaths: (paths) => mm.invoke('mods:importPaths', paths),
      importBuffers: (items) => mm.invoke('mods:importBuffers', items),
      masterState: () => mm.invoke('mods:masterState'),
      setMaster: (enabled) => mm.invoke('mods:setMaster', enabled),
      splitMod: (id) => mm.invoke('mods:splitMod', id),
      dropItemIcons: (id) => mm.invoke('mods:dropItemIcons', id),
      splitExternal: (fileName) => mm.invoke('mods:splitExternal', fileName),
      adoptMod: (id, preview) => mm.invoke('mods:adoptMod', id, preview),
      adoptExternal: (fileName, preview) => mm.invoke('mods:adoptExternal', fileName, preview),
      adoptCursor: (preview) => mm.invoke('mods:adoptCursor', preview),
      adoptFont: (name, preview) => mm.invoke('mods:adoptFont', name, preview),
      pathForFile: (file) => mm.pathOf(file),
    },
    // item schema: the search-path patch, the built schema, and the free cosmetics it enables
    patch: {
      state: () => mm.invoke('patch:state'),
      setEnabled: (on) => mm.invoke('patch:setEnabled', on),
      refreshSchema: () => mm.invoke('schema:refresh'),
      cancelBuild: () => mm.invoke('schema:cancel'),
      // what was done about the last Dota patch, and the two things the banner can ask for
      repairState: () => mm.invoke('patch:repairState'),
      repairNow: () => mm.invoke('patch:repairNow'),
      repairApp: () => mm.invoke('patch:repairApp'),
      repairSeen: () => mm.invoke('patch:repairSeen'),
      onRepair: (cb) => mm.on('patch-repair', cb),
    },
    // the Source 2 toolchain: downloaded on request, never behind the user's back
    tools: {
      state: () => mm.invoke('tools:state'),
      install: (name) => mm.invoke('tools:install', name),
      remove: (name) => mm.invoke('tools:remove', name),
    },
    // Valve's resourcecompiler.exe: found or picked, and the Wine prefix it runs in on Linux
    compiler: {
      state: () => mm.invoke('compiler:state'),
      browse: () => mm.invoke('compiler:browse'),
      forget: () => mm.invoke('compiler:forget'),
      prepare: () => mm.invoke('compiler:prepare'),
      check: () => mm.invoke('compiler:check'),
      keep: () => mm.invoke('compiler:keep'),
      removeKept: () => mm.invoke('compiler:removeKept'),
    },
    // what the app was told from the network: features switched off, dated notices
    config: {
      state: () => mm.invoke('config:state'),
      noticeSeen: (id) => mm.invoke('config:noticeSeen', id),
    },
    cosmetics: {
      slots: () => mm.invoke('cosmetics:slots'),
      pedestals: () => mm.invoke('cosmetics:pedestals'),
      icons: (names, quick) => mm.invoke('cosmetics:icons', names, quick),
      effects: (slots) => mm.invoke('cosmetics:effects', slots),
      heroPortraits: (ids, tall) => mm.invoke('cosmetics:heroPortraits', ids, tall),
      heroPortraitsByName: (names) => mm.invoke('cosmetics:heroPortraitsByName', names),
      pick: (slot, itemId, itemName, effectId, targetItemId) => mm.invoke('cosmetics:pick', slot, itemId, itemName, effectId, targetItemId),
      pickSet: (setId, style) => mm.invoke('cosmetics:pickSet', setId, style),
      wearLook: (hero, picks) => mm.invoke('cosmetics:wearLook', hero, picks),
      dressAll: (keepWorn) => mm.invoke('cosmetics:dressAll', keepWorn),
      undressAll: () => mm.invoke('cosmetics:undressAll'),
    },
    // the 3D preview: the hero's models out of the game, or a catalog mod's files over them
    preview3d: {
      warm: (hero, slots) => mm.invoke('preview3d:warm', hero, slots),
      prefetch: (hero, slots, slot, items) => mm.invoke('preview3d:prefetch', hero, slots, slot, items),
      models: (hero, slots) => mm.invoke('preview3d:models', hero, slots).then(wholeAnswer),
      motions: (body) => mm.invoke('preview3d:motions', body).then(wholeAnswer),
      effect: (id) => mm.invoke('preview3d:effect', id).then(wholeAnswer),
      model: (file) => mm.invoke('preview3d:model', file).then(wholeAnswer),
      pedestalPicture: (model) => mm.invoke('preview3d:pedestalPicture', model),
      keepPedestalPicture: (model, webp) => mm.invoke('preview3d:keepPedestalPicture', model, webp),
      backdrop: (image) => mm.invoke('preview3d:backdrop', image).then(wholeAnswer),
      keepBackdrop: (image, webp) => mm.invoke('preview3d:keepBackdrop', image, webp),
      modHero: (category, file, hint) => mm.invoke('preview3d:modHero', category, file, hint),
      modModels: (category, file, hero, slots) => mm.invoke('preview3d:modModels', category, file, hero, slots).then(wholeAnswer),
      modProps: (category, file, index) => mm.invoke('preview3d:modProps', category, file, index).then(wholeAnswer),
    },
    music: { state: () => mm.invoke('music:state'), keep: (song) => mm.invoke('music:keep', song), install: (songs, menu, game) => mm.invoke('music:install', songs, menu, game) },
    sounds: {
      heroes: () => mm.invoke('sounds:heroes'),
      hero: (hero) => mm.invoke('sounds:hero', hero),
      add: (hero, event, mode, volume, wav, label) => mm.invoke('sounds:add', hero, event, mode, volume, wav, label),
      remove: (hero, event) => mm.invoke('sounds:remove', hero, event),
    },
    creator: {
      list: () => mm.invoke('creator:list'),
      save: (id, fields) => mm.invoke('creator:save', id, fields),
      attach: (id, style, kind) => mm.invoke('creator:attach', id, style, kind),
      fromRecord: (id) => mm.invoke('creator:fromRecord', id),
      remove: (id) => mm.invoke('creator:remove', id),
      export: (id, previews) => mm.invoke('creator:export', id, previews),
      accept: () => mm.invoke('creator:accept'),
      upload: (id, previews) => mm.invoke('creator:upload', id, previews),
      history: () => mm.invoke('creator:history'),
    },
    hud: {
      state: () => mm.invoke('hud:state'),
      install: (parts) => mm.invoke('hud:install', parts),
    },
    fx: {
      search: (query) => mm.invoke('fx:search', query),
      heroes: () => mm.invoke('fx:heroes'),
      hero: (hero) => mm.invoke('fx:hero', hero),
      load: (path) => mm.invoke('fx:load', path),
      preview: (path, edits) => mm.invoke('fx:preview', path, edits),
      install: (path, edits, items) => mm.invoke('fx:install', path, edits, items),
    },
    rank: {
      state: () => mm.invoke('rank:state'),
      pictures: () => mm.invoke('rank:pictures'),
      install: (look) => mm.invoke('rank:install', look),
    },
    decor: {
      state: () => mm.invoke('decor:state'), scene: (map) => mm.invoke('decor:scene', map),
      install: (groups, tint, facets, kind) => mm.invoke('decor:install', groups, tint, facets, kind),
      map: (map) => mm.invoke('decor:map', map).then(wholeAnswer),
      ground: (word, facets) => mm.invoke('decor:ground', word, facets).then(wholeAnswer),
      modTrees: (file) => mm.invoke('decor:modTrees', file),
      paint: (file) => mm.invoke('decor:paint', file).then(wholeAnswer),
      modModel: (file, model) => mm.invoke('decor:modModel', file, model).then(wholeAnswer),
    },
    background: { state: () => mm.invoke('background:state'), install: (webm, source, dim, blur) => mm.invoke('background:install', webm, source, dim, blur) },
    // a hero's portrait and movie in the hero picker of the user's own
    portraits: { state: () => mm.invoke('portraits:state'), hero: (h) => mm.invoke('portraits:hero', h), set: (h, stills, movie, drop, source) => mm.invoke('portraits:set', h, stills, movie, drop, source) },
    // a cursor set of the user's own, every cursor drawn by the window
    cursor: { state: () => mm.invoke('cursor:state'), install: (design, drawn, pictures) => mm.invoke('cursor:install', design, drawn, pictures) },
    // a hero's ability icons picked from his own cosmetics'
    icons: {
      heroes: () => mm.invoke('icons:heroes'),
      hero: (hero) => mm.invoke('icons:hero', hero),
      pictures: (icons) => mm.invoke('icons:pictures', icons),
      set: (hero, ability, icon) => mm.invoke('icons:set', hero, ability, icon),
      clear: (hero) => mm.invoke('icons:clear', hero),
    },
    paint: {
      state: (hero, items) => mm.invoke('paint:state', hero, items),
      icons: (abilities) => mm.invoke('paint:icons', abilities),
      parts: (files) => mm.invoke('paint:parts', files),
      install: (hero, colors, label, items) => mm.invoke('paint:install', hero, colors, label, items),
    },
    map: {
      state: () => mm.invoke('map:state'),
      install: (kind, radiant, dire) => mm.invoke('map:install', kind, radiant, dire),
    },
    arcana: {
      state: () => mm.invoke('arcana:state'),
      install: (set, color, mode) => mm.invoke('arcana:install', set, color, mode),
    },
    // a mod's own video, and the still the window decodes out of it
    preview: {
      video: (key) => mm.invoke('preview:video', key),
      frame: (key, png) => mm.invoke('preview:frame', key, png),
    },
    game: {
      launch: () => mm.invoke('game:launch'),
      steamDownloads: () => mm.invoke('game:steamDownloads'),
      steamProperties: () => mm.invoke('game:steamProperties'),
      // Dota opened or closed: while it is open nothing is written to the game (crates/mm-core/src/game/game_watch.rs)
      onRunning: (cb) => mm.on('game:running', (running) => cb(!!running)),
      // Dota closed seconds after Play (crates/mm-core/src/game/game_watch.rs)
      onQuickExit: (cb) => mm.on('game:quickExit', cb),
    },
    packs: {
      combine: (name, modIds) => mm.invoke('packs:combine', { name, modIds }),
      addMembers: (packId, modIds) => mm.invoke('packs:addMembers', packId, modIds),
      setMemberEnabled: (packId, memberId, enabled) => mm.invoke('packs:setMemberEnabled', packId, memberId, enabled),
      removeMember: (packId, memberId) => mm.invoke('packs:removeMember', packId, memberId),
      extractMembers: (packId, memberIds) => mm.invoke('packs:extractMembers', packId, memberIds),
      disband: (packId) => mm.invoke('packs:disband', packId),
    },
    presets: {
      list: () => mm.invoke('presets:list'),
      save: (name) => mm.invoke('presets:save', name),
      update: (id) => mm.invoke('presets:update', id),
      rename: (id, name) => mm.invoke('presets:rename', id, name),
      delete: (id) => mm.invoke('presets:delete', id),
      apply: (id) => mm.invoke('presets:apply', id),
      exportPlan: (id) => mm.invoke('presets:exportPlan', id),
      exportFile: (id, opts) => mm.invoke('presets:export', id, opts),
      shareLink: (id) => mm.invoke('presets:shareLink', id),
      importDialog: () => mm.invoke('presets:importDialog'),
      importFile: (filePath) => mm.invoke('presets:importFile', filePath),
      resolve: (id) => mm.invoke('presets:resolve', id),
      ready: () => mm.invoke('presets:ready'),
      takeReady: (id) => mm.invoke('presets:takeReady', id),
      onLink: (cb) => mm.on('preset-link', cb),
    },
    community: {
      list: (refresh) => mm.invoke('community:list', refresh),
      publish: (presetId, about) => mm.invoke('community:publish', presetId, about),
      unpublish: (id) => mm.invoke('community:unpublish', id),
      vote: (id, value) => mm.invoke('community:vote', id, value),
      take: (id) => mm.invoke('community:take', id),
    },
    account: {
      signIn: () => mm.invoke('account:signIn'),
      signOut: () => mm.invoke('account:signOut'),
    },
    // likes and follows, through the catalog's account service (crates/mm-core/src/catalog/social.rs)
    social: {
      state: () => mm.invoke('social:state'),
      mark: (kind, name, on) => mm.invoke('social:mark', kind, name, on),
    },
    // the beta channel: shown only to an account the signed list names (crates/mm-core/src/catalog/beta.rs)
    beta: {
      state: () => mm.invoke('beta:state'),
      set: (on) => mm.invoke('beta:set', on),
    },
    presence: {
      view: (name) => mm.invoke('presence:view', name),
    },
    // the window asking for support (crates/mm-core/src/app/support_prompt.rs)
    support: {
      state: () => mm.invoke('support:state'),
      choose: (choice) => mm.invoke('support:choose', choice),
    },
    misc: {
      openLangFolder: () => mm.invoke('misc:openLangFolder'),
      openCacheFolder: () => mm.invoke('misc:openCacheFolder'),
      openToolsFolder: (sub) => mm.invoke('misc:openToolsFolder', sub),
      openExternal: (url) => mm.invoke('misc:openExternal', url),
      cacheSize: () => mm.invoke('misc:cacheSize'),
      clearCache: () => mm.invoke('misc:clearCache'),
      cacheList: () => mm.invoke('misc:cacheList'),
      cacheRemove: (key) => mm.invoke('misc:cacheRemove', key),
      runTool: (dirName) => mm.invoke('misc:runTool', dirName),
    },
    // the pumpkin's key and the mod it opens (crates/mm-core/src/owner/owner_studios.rs)
    pumpkin: {
      redeem: (key) => mm.invoke('pumpkin:redeem', key),
    },
    grids: {
      state: () => mm.invoke('grid:state'),
      apply: (kinds) => mm.invoke('grid:apply', kinds),
      remove: () => mm.invoke('grid:remove'),
    },
    diag: {
      export: () => mm.invoke('diag:export'),
      reportError: (msg) => mm.send('diag:rendererError', msg),
    },
    onProgress: (cb) => {
      mm.on('progress', cb);
    },
    update: {
      install: () => mm.invoke('update:install'),
      fetchPortable: () => mm.invoke('update:fetchPortable'),
      revealPortable: (p) => mm.invoke('update:revealPortable', p),
      version: () => mm.invoke('app:version'),
      notes: (lang) => mm.invoke('app:notes', lang),
      notesSeen: () => mm.invoke('app:notesSeen'),
      stars: () => mm.invoke('app:stars'),
      onUpdate: (cb) => mm.on('update', cb),
    },
  };
})();
