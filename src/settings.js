// Simple JSON settings store in userData
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  dotaGamePath: null,
  // folder mods are installed into: game/dota_<langSuffix>. Decided by Dota's own audio
  // language rather than by us, so Korean speech means dota_koreana and Chinese means
  // dota_schinese; English is the one that has no folder and borrows the Russian one
  // (see keepModFolder in main.js). The value stays a setting because everything downstream
  // reads it, and because an upgrade has to be able to see what the folder used to be.
  langSuffix: 'russian',
  // app UI language: "en" | "ru". English is the default until the user picks otherwise.
  uiLang: 'en',
  // one-time language picker: false for fresh installs AND for users updating from a
  // version without this key, so everybody sees the picker once after this release.
  langPromptSeen: false,
  // zoom factor of the whole window (text and images alike), 0.7 - 1.6
  uiScale: 1,
  // which hero the window is coloured after: ursa | brew | fura | storm | invoker | meepo |
  // bh | axe. The catalog's own site has the same eight and switches them by clicking the
  // mascot beside its logo; h6rd let us bring both across (see renderer/styles/themes.css).
  theme: 'ursa',
  // catalog mods the user starred: "<categoryId>|<mod name>" keys
  favorites: [],
  // sizes and folded state of the title bar, status bar and category rail
  panels: null,
  // Discord identity, when signed in: { id, username, avatar }. No token is ever kept —
  // it is used once to read the name and dropped (see src/discord-auth.js).
  account: null,
  // show "Playing Dota 2 Mod Manager" in Discord while the app is open
  discordPresence: true,
  // Item-schema support ("safe mode" off, in the status bar). The engine reads
  // scripts/items/items_game.txt through the MOD path only (game/dota), so mods that
  // change it - skinchanger-style sets with their own ambient effects, free cosmetics -
  // do nothing from a language folder. Turning this on registers game/dota_mods ahead of
  // the game's content, which means editing gameinfo_branchspecific.gi and re-signing it
  // in dota.signatures. Off (safe) until the user agrees to that once; originals are
  // backed up and the switch reverts them.
  schemaPatch: false,
  // deprecated: cosmetic picks used to live here as { slot: itemId }; migrated once into
  // library records (categoryId 'cosmetic') by schemaService.migrateCosmeticSettings so
  // they can be toggled/deleted/shared like any other mod. Kept only so an old settings
  // file has something to migrate from.
  cosmetics: {},
  // items_game.txt build the deployed schema was made from, to spot a game update
  schemaStamp: null,
  // One-time offer of the Source 2 toolchain, asked once on first run. False for fresh
  // installs and for anybody updating from before it was offered, so everyone gets the
  // question once; the Settings row is the way in afterwards either way.
  toolsPromptSeen: false,
  // Mods the catalog tags adult (18+): true once the user said they are 18 and want them,
  // false once they said no, null until they answer the one-time question
  // (renderer/core/adult.js). Hidden until then.
  showAdult: null,
  // last version whose release notes the user was shown. Null on a fresh install, which is
  // why nobody gets a "what's new" popup for a version they just installed by hand.
  lastSeenVersion: null,
};

class Settings {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        // A byte order mark in front is what Notepad and Windows PowerShell 5 write. JSON.parse
        // refuses it, and every setting fell back to its default: the game path included, so the
        // app went looking for Dota again and could settle on another install than the user's.
        const text = fs.readFileSync(this.file, 'utf-8').replace(/^﻿/, '');
        this.data = { ...DEFAULTS, ...JSON.parse(text) };
      }
    } catch {
      this.data = { ...DEFAULTS };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  all() {
    return { ...this.data };
  }
}

module.exports = { Settings };
