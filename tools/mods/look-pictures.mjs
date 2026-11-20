/**
 * Draw the looks the game keeps no picture of out of their own models, to ship with the app
 * (renderer/public/assets/looks/, listed in renderer/ui/shipped-looks.json). A handful of items in
 * the table name an icon the game never packed: event fishing poles, debut sets, a few pieces.
 * Without this the Items screens show a stand-in for them. Run it after a Dota patch: it asks
 * mm-cli which looks have no picture now and draws only those.
 *
 * Usage: node tools/mods/look-pictures.mjs <throwaway folder>
 * The game is read through junctions and the app runs in a write jail on that folder, as
 * tools/mods/effect-pictures.mjs does. The window turns each model into GLB; a plain Chrome page
 * lights it three quarters on, as renderer/catalog/preview3d/model-thumb.ts draws map props.
 * Needs debug builds of the shell and mm-cli.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openWindow } from '../dev/tauri-window.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv[2]) { console.error('usage: node tools/mods/look-pictures.mjs <throwaway folder>'); process.exit(2); }
const JAIL = path.resolve(process.argv[2]);
const REAL = process.env.DOTA_GAME ?? 'C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game';
const GAME = path.join(JAIL, 'g', 'game');
const USER = path.join(JAIL, 'ud');
const OUT = path.join(root, 'renderer', 'public', 'assets', 'looks');
const LIST = path.join(root, 'renderer', 'ui', 'shipped-looks.json');
const cli = ['release', 'debug'].map((b) => path.join(root, 'target', b, 'mm-cli.exe')).find((p) => fs.existsSync(p));

const missing = JSON.parse(execFileSync(cli, ['looks-without-pictures', REAL], { encoding: 'utf8', maxBuffer: 1 << 24 }));
console.log(`${missing.length} looks without a picture`);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!fs.existsSync(GAME)) {
  fs.mkdirSync(path.join(GAME, 'dota_russian'), { recursive: true });
  for (const n of ['dota', 'bin', 'core']) fs.symlinkSync(path.join(REAL, n), path.join(GAME, n), 'junction');
}
fs.mkdirSync(USER, { recursive: true });
const HAVE = path.join(process.env.APPDATA, 'Dota 2 Mod Manager', 'toolchain');
if (!fs.existsSync(path.join(USER, 'toolchain')) && fs.existsSync(HAVE)) fs.symlinkSync(HAVE, path.join(USER, 'toolchain'), 'junction');
fs.writeFileSync(path.join(USER, 'settings.json'), JSON.stringify({ dotaGamePath: GAME, uiLang: 'en', langPromptSeen: true, toolsPromptSeen: true }));

// the models as GLB, from the window
const glb = new Map();
const app = await openWindow({ args: [`--user-data-dir=${USER}`, `--write-jail=${JAIL}`] });
try {
  await app.page.waitForTimeout(6000);
  for (const { name, model } of missing) {
    if (!model) continue;
    const b64 = await app.page.evaluate(async (file) => {
      const bytes = await globalThis.api.preview3d.model(file);
      if (!bytes) return null;
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }, model);
    if (b64) glb.set(name, b64);
    else console.log('no model', name, model);
  }
} finally {
  await app.close();
}

// drawn in a plain page: three.js served from node_modules under a made-up origin
const { chromium } = createRequire(path.join(root, 'site', 'package.json'))('playwright-core');
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
const page = await browser.newPage();
const three = path.join(root, 'node_modules', 'three');
await page.route('http://looks.local/**', (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>' });
  const file = path.join(three, p.replace(/^\/three\//, ''));
  return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(file) });
});
await page.goto('http://looks.local/');

const W = 512;
const H = 340;
fs.mkdirSync(OUT, { recursive: true });
let list = {};
try { list = JSON.parse(fs.readFileSync(LIST, 'utf8')); } catch { /* the first run: no list yet */ }
for (const [name, b64] of glb) {
  const uri = await page.evaluate(async ({ b64, W, H }) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    scene.add(gltf.scene);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        m.side = THREE.DoubleSide;
        if (m.map && m.transparent) { m.transparent = false; m.alphaTest = 0.4; }
      }
    });
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const FOV = 30;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.01, 1e6);
    const d = Math.max(size.y / 2 / tan, Math.max(size.x, size.z) / 2 / (tan * (W / H))) * 1.08 + Math.max(size.x, size.z) / 4;
    camera.position.set(centre.x + d * 0.5, centre.y + d * 0.2, centre.z + d * 0.85);
    camera.lookAt(centre);
    renderer.render(scene, camera);
    // on the grey the game's own item icons stand on, so the drawn ones sit among them
    const out = globalThis.document.createElement('canvas');
    out.width = W;
    out.height = H;
    const g = out.getContext('2d');
    const bg = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.62);
    bg.addColorStop(0, '#9b9b9b');
    bg.addColorStop(1, '#474747');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.drawImage(renderer.domElement, 0, 0);
    return out.toDataURL('image/webp', 0.86);
  }, { b64, W, H });
  if (!uri?.startsWith('data:image/webp')) { console.log('not drawn', name); continue; }
  const file = `${slug(name)}.webp`;
  fs.writeFileSync(path.join(OUT, file), Buffer.from(uri.split(',')[1], 'base64'));
  list[name] = file;
  console.log('drew', name);
}
await browser.close();
fs.writeFileSync(LIST, JSON.stringify(Object.fromEntries(Object.entries(list).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
console.log(`${Object.keys(list).length} shipped looks in ${path.relative(root, LIST)}`);
