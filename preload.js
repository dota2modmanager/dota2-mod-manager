const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: (cb) => ipcRenderer.on('win:maximized', (e, v) => cb(v)),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    detectDota: () => ipcRenderer.invoke('settings:detectDota'),
    browseDota: () => ipcRenderer.invoke('settings:browseDota'),
    moveLangFiles: (fromSuffix) => ipcRenderer.invoke('settings:moveLangFiles', fromSuffix),
  },
  ui: {
    setZoom: (factor) => ipcRenderer.invoke('ui:setZoom', factor),
    onZoom: (cb) => ipcRenderer.on('ui:zoom', (e, factor) => cb(factor)),
  },
  catalog: {
    load: (force) => ipcRenderer.invoke('catalog:load', force),
    terrainAges: () => ipcRenderer.invoke('catalog:terrainAges'),
  },
  mods: {
    install: (payload) => ipcRenderer.invoke('mods:install', payload),
    list: () => ipcRenderer.invoke('mods:list'),
    switchOffStaleTerrains: () => ipcRenderer.invoke('mods:switchOffStaleTerrains'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('mods:setEnabled', id, enabled),
    remove: (id) => ipcRenderer.invoke('mods:remove', id),
    // a selection at once: one rebuild of the item schema for the batch, not one per mod
    removeMany: (ids) => ipcRenderer.invoke('mods:removeMany', ids),
    // who owns the map archive a terrain is about to replace (maps/dota.vpk is one file)
    mapsOwner: () => ipcRenderer.invoke('mods:mapsOwner'),
    setEnabledMany: (ids, enabled) => ipcRenderer.invoke('mods:setEnabledMany', ids, enabled),
    move: (id, dir) => ipcRenderer.invoke('mods:move', id, dir),
    reorder: (id, toIndex) => ipcRenderer.invoke('mods:reorder', id, toIndex),
    externalSetEnabled: (fileName, enabled) => ipcRenderer.invoke('mods:externalSetEnabled', fileName, enabled),
    externalRemove: (fileName) => ipcRenderer.invoke('mods:externalRemove', fileName),
    exportSingle: (id) => ipcRenderer.invoke('mods:exportSingle', id),
    unpackToFolder: (id) => ipcRenderer.invoke('mods:unpackToFolder', id),
    // the pre-patch mark off one mod, once its owner checked it in the game
    clearPrePatch: (id) => ipcRenderer.invoke('mods:clearPrePatch', id),
    importDialog: () => ipcRenderer.invoke('mods:importDialog'),
    importFolderDialog: () => ipcRenderer.invoke('mods:importFolderDialog'),
    importPaths: (paths) => ipcRenderer.invoke('mods:importPaths', paths),
    importBuffers: (items) => ipcRenderer.invoke('mods:importBuffers', items),
    masterState: () => ipcRenderer.invoke('mods:masterState'),
    setMaster: (enabled) => ipcRenderer.invoke('mods:setMaster', enabled),
    splitMod: (id) => ipcRenderer.invoke('mods:splitMod', id),
    splitExternal: (fileName) => ipcRenderer.invoke('mods:splitExternal', fileName),
    adoptMod: (id, preview) => ipcRenderer.invoke('mods:adoptMod', id, preview),
    adoptExternal: (fileName, preview) => ipcRenderer.invoke('mods:adoptExternal', fileName, preview),
    adoptCursor: (preview) => ipcRenderer.invoke('mods:adoptCursor', preview),
    adoptFont: (name, preview) => ipcRenderer.invoke('mods:adoptFont', name, preview),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  // item schema: the search-path patch, the built schema, and the free cosmetics it enables
  patch: {
    state: () => ipcRenderer.invoke('patch:state'),
    setEnabled: (on) => ipcRenderer.invoke('patch:setEnabled', on),
    refreshSchema: () => ipcRenderer.invoke('schema:refresh'),
    // what was done about the last Dota patch, and the two things the banner can ask for
    repairState: () => ipcRenderer.invoke('patch:repairState'),
    repairNow: () => ipcRenderer.invoke('patch:repairNow'),
    repairSeen: () => ipcRenderer.invoke('patch:repairSeen'),
    onRepair: (cb) => ipcRenderer.on('patch-repair', (e, st) => cb(st)),
  },
  // the Source 2 toolchain: downloaded on request, never behind the user's back
  tools: {
    state: () => ipcRenderer.invoke('tools:state'),
    install: (name) => ipcRenderer.invoke('tools:install', name),
    remove: (name) => ipcRenderer.invoke('tools:remove', name),
  },
  // what the app was told from the network: features switched off, dated notices
  config: {
    state: () => ipcRenderer.invoke('config:state'),
    noticeSeen: (id) => ipcRenderer.invoke('config:noticeSeen', id),
  },
  cosmetics: {
    slots: () => ipcRenderer.invoke('cosmetics:slots'),
    icons: (names) => ipcRenderer.invoke('cosmetics:icons', names),
    heroPortraits: (ids) => ipcRenderer.invoke('cosmetics:heroPortraits', ids),
    heroPortraitsByName: (names) => ipcRenderer.invoke('cosmetics:heroPortraitsByName', names),
    pick: (slot, itemId, itemName, effectId) => ipcRenderer.invoke('cosmetics:pick', slot, itemId, itemName, effectId),
    pickSet: (setId) => ipcRenderer.invoke('cosmetics:pickSet', setId),
  },
  // a mod's own video, and the still the window decodes out of it
  preview: {
    video: (key) => ipcRenderer.invoke('preview:video', key),
    frame: (key, png) => ipcRenderer.invoke('preview:frame', key, png),
  },
  game: {
    launch: () => ipcRenderer.invoke('game:launch'),
  },
  packs: {
    combine: (name, modIds) => ipcRenderer.invoke('packs:combine', { name, modIds }),
    addMembers: (packId, modIds) => ipcRenderer.invoke('packs:addMembers', packId, modIds),
    setMemberEnabled: (packId, memberId, enabled) => ipcRenderer.invoke('packs:setMemberEnabled', packId, memberId, enabled),
    removeMember: (packId, memberId) => ipcRenderer.invoke('packs:removeMember', packId, memberId),
    extractMembers: (packId, memberIds) => ipcRenderer.invoke('packs:extractMembers', packId, memberIds),
    disband: (packId) => ipcRenderer.invoke('packs:disband', packId),
  },
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (name) => ipcRenderer.invoke('presets:save', name),
    update: (id) => ipcRenderer.invoke('presets:update', id),
    rename: (id, name) => ipcRenderer.invoke('presets:rename', id, name),
    delete: (id) => ipcRenderer.invoke('presets:delete', id),
    apply: (id) => ipcRenderer.invoke('presets:apply', id),
    exportPlan: (id) => ipcRenderer.invoke('presets:exportPlan', id),
    exportFile: (id, opts) => ipcRenderer.invoke('presets:export', id, opts),
    shareLink: (id) => ipcRenderer.invoke('presets:shareLink', id),
    importDialog: () => ipcRenderer.invoke('presets:importDialog'),
    importFile: (filePath) => ipcRenderer.invoke('presets:importFile', filePath),
    resolve: (id) => ipcRenderer.invoke('presets:resolve', id),
    onLink: (cb) => ipcRenderer.on('preset-link', (e, res) => cb(res)),
  },
  account: {
    signIn: () => ipcRenderer.invoke('account:signIn'),
    signOut: () => ipcRenderer.invoke('account:signOut'),
  },
  // the beta channel: shown only to an account the signed list names (src/beta.ts)
  beta: {
    state: () => ipcRenderer.invoke('beta:state'),
    set: (on) => ipcRenderer.invoke('beta:set', on),
  },
  presence: {
    view: (name) => ipcRenderer.invoke('presence:view', name),
  },
  misc: {
    openLangFolder: () => ipcRenderer.invoke('misc:openLangFolder'),
    openToolsFolder: (sub) => ipcRenderer.invoke('misc:openToolsFolder', sub),
    openExternal: (url) => ipcRenderer.invoke('misc:openExternal', url),
    cacheSize: () => ipcRenderer.invoke('misc:cacheSize'),
    clearCache: () => ipcRenderer.invoke('misc:clearCache'),
    runTool: (dirName) => ipcRenderer.invoke('misc:runTool', dirName),
  },
  diag: {
    export: () => ipcRenderer.invoke('diag:export'),
    reportError: (msg) => ipcRenderer.send('diag:rendererError', msg),
  },
  onProgress: (cb) => {
    ipcRenderer.on('progress', (e, evt) => cb(evt));
  },
  update: {
    install: () => ipcRenderer.invoke('update:install'),
    fetchPortable: () => ipcRenderer.invoke('update:fetchPortable'),
    revealPortable: (p) => ipcRenderer.invoke('update:revealPortable', p),
    version: () => ipcRenderer.invoke('app:version'),
    notes: (lang) => ipcRenderer.invoke('app:notes', lang),
    notesSeen: () => ipcRenderer.invoke('app:notesSeen'),
    onUpdate: (cb) => ipcRenderer.on('update', (e, evt) => cb(evt)),
  },
});
