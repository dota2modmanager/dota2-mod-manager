// Item pictures taken from the installed game instead of scraped off a wiki.
//
// The cosmetics picker needs a thumbnail for every item it offers, and until now those came
// from the Dota wiki: matched by name, rate-limited, wrong when two items are named alike,
// missing for anything the wiki never covered, and useless offline. The game already ships
// every one of them - the item table says where each picture lives (`image_inventory`), and
// the picture itself sits in the game's own pak01 as a compiled texture.
//
// Almost all of them need no decoding at all. Panorama's images are authored as PNG and
// compiled with the format left as PNG, so the .vtex_c is a short header with the PNG file
// appended (see src/vtex.ts): of 3000 item icons in the installed game, 2877 come out whole
// by slicing the header off. Those cost one seek each and work offline, on a fresh install,
// with nothing downloaded.
//
// The rest are block-compressed, and reading those does need the Source 2 toolchain (see
// src/toolchain.js), 48 MB and fetched only if the user asks for it. Without it those few
// fall back to the wiki, as everything used to.
//
// Measured on the real game (2026-08-07): 10 299 items carry a picture, every option in every
// slot the picker offers has one, and their names are unique, so a name is a safe key. One
// CLI call for nine icons costs 898 ms while one call for one costs 865 - the price is
// starting the program, not the icons - so misses are always fetched in one batch.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const schema = require('./schema');
const { openVpkIndex } = require('./vpk');
const { pngFromVtex } = require('./vtex.ts');

// Enough to fill a screen of tiles in one go; the renderer asks in batches of 24.
const MAX_PER_CALL = 60;
// A tool that has not answered by now is not going to. The user waits on this: the picker
// shows placeholders until it returns.
const CALL_TIMEOUT_MS = 60000;

const safeName = (imagePath) => `${crypto.createHash('sha1').update(imagePath).digest('hex').slice(0, 16)}.png`;

/**
 * @param {object} deps
 * @param {string} deps.userDataDir
 * @param {{ pathOf: (name: string) => string|null, ensure: (name: string) => Promise<string> }} deps.toolchain
 * @param {() => string|null} deps.getGamePath
 * @param {(msg: string) => void} [deps.log]
 */
function createGameIcons({ userDataDir, toolchain, getGamePath, log = () => {} }) {
  const root = path.join(userDataDir, 'icons', 'game');
  let index = null;      // name -> image_inventory path, built from the installed game
  let indexStamp = null; // which build of the game it was built from
  let pak = null;        // the game's own archive, opened once: its tree is 384 001 entries
  let pakStamp = null;

  function pakPath() {
    const game = getGamePath();
    return game ? path.join(game, 'dota', 'pak01_dir.vpk') : null;
  }

  /** The game's own answer to "where is this item's picture", rebuilt when the game changes. */
  function nameIndex() {
    const game = getGamePath();
    if (!game) return null;
    let stamp = null;
    try { stamp = schema.gameSchemaStamp(game); } catch { /* unreadable: rebuild every time */ }
    if (index && stamp && stamp === indexStamp) return index;
    try {
      const { text } = schema.readGameSchema(game);
      const map = new Map();
      for (const item of schema.listItems(text)) {
        if (item.image && item.name) map.set(item.name, item.image);
      }
      index = map;
      indexStamp = stamp;
      log(`game icons: ${map.size} items know where their picture is`);
    } catch (err) {
      log(`game icons: item table unreadable (${err.message || err})`);
      return null;
    }
    // a new build of the game means new pictures: the old cache is not worth keeping
    if (stamp) {
      const marker = path.join(root, 'stamp');
      let old = null;
      try { old = fs.readFileSync(marker, 'utf-8'); } catch { /* first run */ }
      if (old !== stamp) {
        fs.rmSync(root, { recursive: true, force: true });
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(marker, stamp);
      }
    }
    return index;
  }

  const cacheFile = (imagePath) => path.join(root, safeName(imagePath));
  const texturePath = (imagePath) => `panorama/images/${imagePath}_png.vtex_c`;

  /** The game's archive, read once per build rather than once per picture. */
  function pakIndex() {
    const file = pakPath();
    if (!file || !fs.existsSync(file)) return null;
    let stamp = null;
    try { const st = fs.statSync(file); stamp = `${st.size}:${st.mtimeMs}`; } catch { /* reopen */ }
    if (pak && stamp && stamp === pakStamp) return pak;
    try {
      pak = openVpkIndex(file);
      pakStamp = stamp;
      log(`game icons: pak01 index of ${pak.size} entries`);
    } catch (err) {
      log(`game icons: pak01 unreadable (${err.message || err})`);
      pak = null;
    }
    return pak;
  }

  /** Is this usable right now? The game alone is enough for the pictures it stores as PNG. */
  function ready() {
    return !!(pakPath() && fs.existsSync(pakPath()));
  }

  function runCli(exe, args) {
    return new Promise((resolve, reject) => {
      execFile(exe, args, { timeout: CALL_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Pull these pictures out of the game and into the cache.
   * @param {string[]} imagePaths values of image_inventory, e.g. "econ/items/abaddon/..."
   */
  async function extract(imagePaths) {
    const left = takeReadyMade(imagePaths);
    if (!left.length) return;
    // whatever is stored compressed rather than as a picture: the toolchain or nothing
    const exe = toolchain.pathOf('vrf');
    const pakFile = pakPath();
    if (!exe || !pakFile) return;
    const imagePathsLeft = left;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-icons-'));
    try {
      const filter = imagePathsLeft.map(texturePath).join(',');
      await runCli(exe, ['-i', pakFile, '-o', tmp, '-d', '-f', filter]);
      fs.mkdirSync(root, { recursive: true });
      for (const imagePath of imagePathsLeft) {
        // the tool keeps the archive's own layout, with the compiled extension resolved
        const from = path.join(tmp, 'panorama', 'images', ...`${imagePath}_png.png`.split('/'));
        if (!fs.existsSync(from)) continue;
        fs.copyFileSync(from, cacheFile(imagePath));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /**
   * Copy out every picture the game already stores as one, and say which are left.
   * @param {string[]} imagePaths
   * @returns {string[]} the ones nothing here could read
   */
  function takeReadyMade(imagePaths) {
    const ix = pakIndex();
    if (!ix) return imagePaths.slice();
    const left = [];
    fs.mkdirSync(root, { recursive: true });
    for (const imagePath of imagePaths) {
      try {
        const png = pngFromVtex(ix.read(texturePath(imagePath)));
        if (png) fs.writeFileSync(cacheFile(imagePath), png);
        else left.push(imagePath);
      } catch (err) {
        log(`game icons: ${imagePath} unreadable (${err.message || err})`);
        left.push(imagePath);
      }
    }
    return left;
  }

  /**
   * Pictures for these item names, as data URIs. Anything the game does not have (or that the
   * toolchain could not read) comes back missing, and the caller falls back to the wiki.
   * @param {string[]} names
   * @returns {Promise<Record<string, string>>}
   */
  async function getMany(names) {
    /** @type {Record<string, string>} */
    const out = {};
    if (!ready()) return out;
    const map = nameIndex();
    if (!map) return out;

    const wanted = new Map(); // image path -> [names asking for it]
    for (const name of names) {
      const imagePath = map.get(name);
      if (!imagePath) continue;
      const file = cacheFile(imagePath);
      if (fs.existsSync(file)) {
        out[name] = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
        continue;
      }
      if (!wanted.has(imagePath)) wanted.set(imagePath, []);
      wanted.get(imagePath).push(name);
    }
    if (!wanted.size) return out;

    const paths = [...wanted.keys()];
    for (let i = 0; i < paths.length; i += MAX_PER_CALL) {
      const chunk = paths.slice(i, i + MAX_PER_CALL);
      try {
        await extract(chunk);
      } catch (err) {
        log(`game icons: extraction failed (${err.message || err})`);
        break; // the wiki answers for the rest
      }
    }
    for (const [imagePath, asking] of wanted) {
      const file = cacheFile(imagePath);
      if (!fs.existsSync(file)) continue;
      const uri = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
      for (const name of asking) out[name] = uri;
    }
    return out;
  }

  function size() {
    let bytes = 0;
    try { for (const f of fs.readdirSync(root)) bytes += fs.statSync(path.join(root, f)).size; } catch { /* nothing cached */ }
    return bytes;
  }

  function clear() {
    fs.rmSync(root, { recursive: true, force: true });
    index = null;
    indexStamp = null;
  }

  /**
   * Each hero's portrait out of the installed game, as data URIs, for the item builder's hub:
   * the player's own copy rather than pictures shipped with the app.
   *
   * The landscape one first. Measured on the game of 2026-09-24, only 24 of 124 are stored as a
   * plain PNG, the rest block-compressed, so the toolchain opens those when it is here. Without
   * it, the portrait from hero selection, which is a PNG for 116 of them. The eight left (the
   * newest heroes) keep their glyph. Both go into the same cache as item pictures.
   * @param {string[]} ids  hero ids without the npc_dota_hero_ prefix, e.g. "antimage"
   * @returns {Promise<Record<string, string>>} the ones a picture was found for
   */
  async function heroPortraits(ids) {
    /** @type {Record<string, string>} */
    /** @type {Record<string, string>} */
    const out = {};
    if (!ready()) return out;
    // names, never paths: they go into one
    const valid = [...new Set(ids)].filter((id) => typeof id === 'string' && /^[a-z0-9_]+$/.test(id));
    const wide = (id) => `heroes/npc_dota_hero_${id}`;
    const tall = (id) => `heroes/selection/npc_dota_hero_${id}`;
    const cached = (imagePath) => fs.existsSync(cacheFile(imagePath));
    await extract(valid.map(wide).filter((p) => !cached(p)));
    takeReadyMade(valid.filter((id) => !cached(wide(id))).map(tall).filter((p) => !cached(p)));
    for (const id of valid) {
      const hit = [wide(id), tall(id)].find(cached);
      if (hit) out[id] = `data:image/png;base64,${fs.readFileSync(cacheFile(hit)).toString('base64')}`;
    }
    return out;
  }

  return { ready, getMany, heroPortraits, size, clear, root };
}

module.exports = { createGameIcons };
