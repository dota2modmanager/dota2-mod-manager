/**
 * `modkit pictures`: a hero's pictures in the game's interface, out as PNG and back in.
 *
 *   modkit pictures necrolyte --out work/pics
 *     ability icons, the top-bar portrait, the minimap and pick-screen icons, the pick card, as PNG
 *     under their game paths (work/pics/panorama/images/...), and the minimap sheet with the hero's
 *     32x32 cell (needs Source2Viewer: the sheet is block-compressed)
 *   modkit pictures necrolyte --from work/pics --addon my_mod --out work/mod
 *     every PNG under --from compiled back under its own path; a 32x32 work/pics/minimap.png goes
 *     into the hero's cell of the minimap sheet; a hover video at
 *     panorama/videos/heroes/npc_dota_hero_<hero>.webm is copied as it is
 *
 * Panorama compiles a picture only through a stylesheet that names it, so a stylesheet naming all
 * of them is compiled with -r and left out of the mod; only the pictures go in.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCompiler } from './commands.mjs';
import { pak01, src } from './game.mjs';
import { escapeRe, heroId, locate, toolCandidates, walkFiles } from './lib.mjs';

/** The panorama pictures of a hero in pak01, compiled path -> PNG path. */
export function heroPictures(paths, hero) {
  const out = new Map();
  const h = escapeRe(hero);
  const mine = new RegExp(`^panorama/images/(spellicons/${h}_[^/]+|heroes/(icons/|selection/)?npc_dota_hero_${h})_png\\.vtex_c$`);
  for (const p of paths) if (mine.test(p)) out.set(p, p.replace(/_png\.vtex_c$/, '.png'));
  return out;
}

/** The hero's cell in the minimap sheet, from scripts/mod_textures.txt. */
export function minimapCell(text, hero) {
  const at = text.indexOf(`"minimap_heroicon_npc_dota_hero_${hero}"`);
  if (at < 0) return null;
  const body = text.slice(at, text.indexOf('}', at));
  const n = (k) => Number(new RegExp(`"${k}"\\s+"(\\d+)"`).exec(body)?.[1]);
  return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
}

/** A stylesheet naming each picture, which is what makes panorama's compiler build them. */
export function namingSheet(pngs) {
  return pngs.map((p, i) => `.mm${i} { background-image: url("file://{images}/${p.replace(/^panorama\/images\//, '')}"); }\n`).join('');
}

const sha = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const MANIFEST = 'pictures.json';   // the extracted PNGs' fingerprints: what was not edited stays out

const MINIMAP_VMAT = 'materials/vgui/hud/minimap_hero_sheet.vmat_c';
const MINIMAP_PNG = 'panorama/images/mods/minimap_hero_sheet.png';

async function sheetTexture(index) {
  const { references } = await src('resource.ts');
  return references(index.read(MINIMAP_VMAT)).find((r) => r.endsWith('.vtex')) + '_c';
}

export async function pictures(opts) {
  const { game, index } = await pak01(opts);
  const { HERO_DISPLAY } = await src('hero-names.ts');
  const hero = heroId(opts._[0] ?? '', HERO_DISPLAY);
  if (!hero || !opts.out) throw new Error('usage: modkit pictures <hero> --out <dir> [--from <pictures dir> --addon <name>]');
  const cellText = index.read('scripts/mod_textures.txt')?.toString('utf8') ?? '';
  const cell = minimapCell(cellText, hero);
  if (typeof opts.from === 'string') return build(opts, game, index, hero, cell);

  const { pngFromVtex } = await src('vtex.ts');
  const found = heroPictures(index.paths(), hero);
  if (!found.size) throw new Error(`no pictures of ${hero} in pak01`);
  const vrf = locate(toolCandidates('vrf'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modkit-'));
  // most are a PNG inside the resource; the rest are block-compressed and need Source2Viewer
  const toPng = (rel, out) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const data = index.read(rel);
    const png = pngFromVtex(data);
    if (png) { fs.writeFileSync(out, png); return true; }
    if (!vrf) return false;
    // Source2Viewer names its output after the input: decompile into a folder of its own, then move
    const dir = fs.mkdtempSync(path.join(tmp, 'v'));
    const file = path.join(dir, path.basename(rel));
    fs.writeFileSync(file, data);
    spawnSync(vrf, ['-i', file, '-o', path.join(dir, 'out'), '-d'], { encoding: 'utf8' });
    const made = walkFiles(dir).map(([, abs]) => abs).find((f) => f.endsWith('.png'));
    if (made) fs.renameSync(made, out);
    return !!made;
  };
  let missed = 0;
  const prints = {};
  for (const [rel, png] of found) {
    if (toPng(rel, path.join(opts.out, png))) { console.log(png); prints[png] = sha(path.join(opts.out, png)); }
    else { console.log(`skipped ${rel}: block-compressed, needs Source2Viewer`); missed++; }
  }
  fs.writeFileSync(path.join(opts.out, MANIFEST), JSON.stringify(prints, null, 1));
  if (cell && toPng(await sheetTexture(index), path.join(opts.out, 'minimap_hero_sheet.png'))) {
    console.log(`minimap_hero_sheet.png: ${hero} is the ${cell.width}x${cell.height} cell at ${cell.x},${cell.y}. `
      + 'Draw a minimap.png of that size next to it to replace it.');
  } else missed++;
  fs.rmSync(tmp, { recursive: true, force: true });
  if (missed) console.log(`${missed} picture(s) need Source2Viewer (modkit check)`);
  console.log(`\nEdit the PNGs in place (same size, keep the alpha), then:\n  npm run modkit -- pictures ${hero} --from ${opts.out} --addon <name> --out <mod dir>`);
}

async function build(opts, game, index, hero, cell) {
  const addon = opts.addon;
  if (!addon || !/^[a-z0-9_]{1,64}$/.test(addon)) throw new Error('--addon <name> (lower case, digits, _) to compile in');
  const from = opts.from;
  const content = path.join(path.dirname(game), 'content', 'dota_addons', addon);
  const compiled = path.join(game, 'dota_addons', addon);
  const prints = fs.existsSync(path.join(from, MANIFEST)) ? JSON.parse(fs.readFileSync(path.join(from, MANIFEST), 'utf8')) : {};
  const pngs = walkFiles(from).map(([rel]) => rel.replace(/\\/g, '/'))
    .filter((r) => r.startsWith('panorama/images/') && r.endsWith('.png') && prints[r] !== sha(path.join(from, r)));
  const minimap = path.join(from, 'minimap.png');
  let sheetOut = null;
  if (fs.existsSync(minimap)) {
    if (!cell) throw new Error(`no minimap cell for ${hero} in scripts/mod_textures.txt`);
    const sheetPng = path.join(from, 'minimap_hero_sheet.png');
    if (!fs.existsSync(sheetPng)) throw new Error('minimap.png needs minimap_hero_sheet.png next to it: run modkit pictures <hero> --out first');
    const py = locate(toolCandidates('python'));
    if (!py) throw new Error('the minimap needs Python with Pillow (modkit check)');
    const dst = path.join(content, MINIMAP_PNG);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const script = 'import sys\nfrom PIL import Image\ns=Image.open(sys.argv[1]).convert("RGBA")\nx,y,w,h=map(int,sys.argv[4:8])\n'
      + 's.paste(Image.new("RGBA",(w,h)),(x,y))\ns.alpha_composite(Image.open(sys.argv[2]).convert("RGBA").resize((w,h),Image.LANCZOS),(x,y))\ns.save(sys.argv[3])';
    const r = spawnSync(py, ['-c', script, sheetPng, minimap, dst, cell.x, cell.y, cell.width, cell.height].map(String), { encoding: 'utf8' });
    if (r.status) throw new Error(`the minimap sheet: ${r.stderr}`);
    sheetOut = await sheetTexture(index);
  }
  for (const rel of pngs) {
    const dst = path.join(content, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(from, rel), dst);
  }
  const named = [...pngs, ...(sheetOut ? [MINIMAP_PNG] : [])];
  const written = [];
  if (named.length) {
    const css = path.join(content, 'panorama/styles/mods_pictures.css');
    fs.mkdirSync(path.dirname(css), { recursive: true });
    fs.writeFileSync(css, namingSheet(named));
    fs.mkdirSync(compiled, { recursive: true });
    const r = runCompiler(game, [css], ['-r']);
    if (!r.ok) throw new Error(`the compiler failed:\n${r.lines.filter((l) => /rror|failed/.test(l)).slice(-20).join('\n')}`);
    const copy = (fromRel, toRel) => {
      const out = path.join(opts.out, toRel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(path.join(compiled, fromRel), out);
      written.push(toRel);
    };
    for (const rel of pngs) copy(rel.replace(/\.png$/, '_png.vtex_c'), rel.replace(/\.png$/, '_png.vtex_c'));
    if (sheetOut) copy(MINIMAP_PNG.replace(/\.png$/, '_png.vtex_c'), sheetOut);
  }
  const video = `panorama/videos/heroes/npc_dota_hero_${hero}.webm`;
  if (fs.existsSync(path.join(from, video))) {
    fs.mkdirSync(path.dirname(path.join(opts.out, video)), { recursive: true });
    fs.copyFileSync(path.join(from, video), path.join(opts.out, video));
    written.push(video);
  }
  for (const w of written) console.log(w);
  console.log(`\n${written.length} file(s) in ${opts.out}`);
}
