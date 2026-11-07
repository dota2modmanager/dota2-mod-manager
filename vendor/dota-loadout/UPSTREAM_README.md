# Loadout

Every Dota 2 hero, rendered live in the browser with three.js — with the game's own hero shader,
loadout lighting, animations and particle effects.

**Demo:** https://loadout.nyan.cafe/ · **Repo:** https://github.com/justkiddingxd/dota-loadout

- **Library** (`src/`, `npm i dota-loadout three`) — `new HeroViewer(canvas)`, `await viewer.load('pudge')`,
  a `Loadout` that dresses a hero as the site does, and a `<dota-hero>` element.
- **Heroes and items** (`assets/`) — all heroes and ~11 000 of their items, ready to load: compressed glTF
  models, WebP textures, one `hero.json` / `item.json` each. Served from https://loadout.nyan.cafe/ (open to
  any site), which the library loads from by default.
- **Pipeline** (`tools/`) — rebuilds those folders from the game's files after a patch (`tools/update.mjs`).
- **Site** (`site/`) — the demo above.

## Use the library

```sh
npm i dota-loadout three
```

The quickest: an element, no code.

```html
<script type="module">import 'dota-loadout/element';</script>

<dota-hero hero="juggernaut" style="width: 480px; height: 640px"></dota-hero>
<!-- a hero as the site's address has him: items, styles, gems, unusual effects, kinetic gems -->
<dota-hero loadout="#terrorblade/hero_base=5957~gold,weapon=12917,back=9750" animation="loadout"></dota-hero>
```

Attributes: `hero`, `loadout`, `animation`, `assets`, `controls` (`true`, `hero`, `false`), `wheel`
(`zoom`, `turn`, `false`), `bloom` (a strength or `false`). `element.viewer` and `element.loadout` are the
objects below; `load` and `progress` events tell how loading goes.

The viewer, for your own canvas:

```js
import { HeroViewer, Loadout } from 'dota-loadout';

const viewer = new HeroViewer(document.getElementById('hero'));
const hero = await viewer.load('nevermore');               // an id, or a hero folder's address
console.log(hero.animations);                              // [{ name, activity, loop }, …]
viewer.play('attack01_anim');                              // plays once, then back to the idle
await viewer.wear('weapon', 6058);                         // an item's id (or folder), in a style
viewer.paused = true;                                      // stands still; he still turns

// A whole outfit, as the site does it: the hero's form for an arcana or a persona, prismatic gems,
// unusual effects, kinetic gems. Catalogs: heroes/<id>/items.json.
const look = new Loadout(viewer);
await look.show('#crystal_maiden/head=4388^13');           // the site's address (# optional)
await look.show('terrorblade', { hero_base: 5957, weapon: [12917, 0] }, { gems: { hero_base: 'gold' } });
await look.wear('back', 9750); await look.gem('hero_base', 'rubiline');
look.kinetics;                                             // the hero's kinetic gems: [{ id, name, changes }]
look.address;                                              // '#terrorblade/hero_base=5957~rubiline,…'
```

Without a bundler, an import map: `"three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js"`,
`"three/addons/": "…/examples/jsm/"`, `"dota-loadout": "https://cdn.jsdelivr.net/npm/dota-loadout/src/index.js"`.
Types are included (`src/index.d.ts`). To serve the heroes yourself, copy `assets/` (or build it with the
pipeline) and pass `assets: 'https://your.host/'`.

### Options

```js
new HeroViewer(canvas, {
  assets: 'https://loadout.nyan.cafe/', // where ids are looked up
  controls: true,      // drag to turn: true, 'hero' (only when the drag starts on the hero), false
  wheel: 'zoom',       // 'zoom', 'turn' or false
  framing: 'hero',     // 'hero' (fit the hero) or 'full' (hero and pedestal whole)
  pixelRatio: 2,
  textureScale: 1,     // 0.5 by default on phones and machines of 4 GB or less: a quarter of the GPU memory
  softParticles: true, // effects fade where they meet the hero (depth feathering): one more depth pass a frame
  bloom: 0.35,         // the halo of what is brighter than white, or false
  onProgress: (loaded, total) => {},
  onAnimation: (name) => {},
});
viewer.gem(slot, '#rrggbb')          // a prismatic gem's colour in a slot's item
viewer.unusual(slot, id)             // an unusual effect of the item's list
viewer.kinetic(slot, activities)     // a kinetic gem's [[activity, modifier]]
viewer.rotate(angle, { relative })   // turn the hero (radians), eased
viewer.zoom(1.5)                     // 0.6 – 3
viewer.dispose()
```

The canvas is transparent: put any background behind it.

## What is rendered

- **Hero shader.** Dota's `hero.vfx` forward pass on top of three's Phong: masks for detail,
  self-illumination, rim and specular, metalness, tint by base colour, the fresnel warp texture, the
  scrolling detail layer, half-Lambert light — see `src/material.js`.
- **Light.** Each hero's own light from `portraits_full_body_loadout.txt` (key light with shadows,
  directional ambient, shadow colour), drawn in HDR and tone mapped with a soft knee.
- **Animations.** For every activity the plainest sequence is kept (loadout, idle, run, attacks,
  abilities, teleport, victory, taunt, death…); the loadout spawn plays once on load.
- **Items.** The default wearables are bone-merged onto the hero's skeleton, like the game does.
- **Animation events.** Effects the animations start and stop at their frames
  (AE_CL_CREATE_PARTICLE_EFFECT…), with each system's own control point configuration, and props
  they bring in (AE_CL_CREATE_ANIM_SCOPE_PROP: Pudge's clown car). Models drawn by particles
  (C_OP_RenderModels: Arc Warden's taunt cane and hat) play their own clips.
- **Particles.** The default items' effects: Source 2 particle systems ported from
  [Source 2 Viewer](https://github.com/ValveResourceFormat/ValveResourceFormat) with model-bound
  operators (snapshots skinned to bones, attachments, control point drivers) — see `src/fx.js`.

## Rebuild the heroes

The game's files never leave your machine except as the archive you make yourself.

1. **On Windows, with Dota 2 installed:** run `tools/extract-dota.cmd`. It finds the game through
   Steam, follows the references from every hero's model, default items and loadout portrait, and packs
   only what is needed (~800 MB) into `dota2heroes-<build>.zip` on the Desktop.
2. **Anywhere with Node 22+ and `cwebp`:**

   ```sh
   npm install
   npm run heroes -- --zip dota2heroes-6944.zip          # all heroes, ~20 min on 4 threads
   npm run heroes -- --only nevermore,juggernaut --keep   # some, keeping the rest
   ```

   [Source2Viewer-CLI](https://github.com/ValveResourceFormat/ValveResourceFormat) is downloaded into
   `.cache/` on the first run. The result goes to `assets/heroes/` with an `index.json` roster.

3. `npm run dev` for the site, `npm run build` to put it into `dist/`.

### Cosmetics

Every wearable of a hero can be put on in the viewer (`viewer.wear(slot, 'items/<id>/', style)`, or the
site's item rail). Their files come straight from Steam, without a game install:

```sh
# once, by hand: a Steam account with Dota 2 in its library; asks for the password and the Steam Guard code
cd .cache/steam && ./DepotDownloader -app 570 -depot 373301 -filelist files.txt -dir dl -username <login> -remember-password -no-mobile
echo <login> > username.txt
# then: every hero file and cosmetic (~11 GB unpacked; the ~400 archives are fetched and dropped in turn)
node tools/fetch-dota.mjs
npm run heroes -- --game .cache/steam/game/dota
node tools/build-items.mjs --game .cache/steam/game/dota --cli .cache/vrf-20.0/Source2Viewer-CLI --only marci,juggernaut,pudge
# after a patch: what is new (items, arcanas, personas, heroes) fetched, built and deployed
node tools/update.mjs
```

The server runs `tools/update.mjs` daily (`loadout-update.timer`, logs in `journalctl -u loadout-update`);
when Steam asks for the password again, the run stops there until the login above is repeated by hand.

An item with a prismatic socket in the game (Terrorblade's and Techies' arcanas) takes a gem
(`viewer.gem(slot, '#rrggbb')`; the catalog marks it `prismatic` with the gem it comes with), and an unusual effect when it can roll one: the effects of its
season's list, Crownfall, Frostivus or New Bloom (`viewer.unusual(slot, 836)`; the catalog lists them
under `unusual`). The site keeps both in the address: `#nevermore/arms=29087~creators_light!837`.

Items go to `assets/items/<id>/` (models, materials and effects of all their styles), each hero's catalog
to `assets/heroes/<id>/items.json`. They are not kept in git (about 250 KB an item, 10 000 items). Not
done yet: taunts, pets, personas, arcanas and items that change animations.

### `hero.json`

```jsonc
{
  "id": "nevermore", "name": { "en": "Shadow Fiend", "ru": "Shadow Fiend" },
  "models": { "hero": "models/hero.glb", "head": "models/head.glb", "pedestal": "models/pedestal.glb" },
  "animations": { "idle": "loadout", "entry": "loadout_spawn_anim", "list": [{ "name": "run_anim", "activity": "ACT_DOTA_RUN", "loop": true }] },
  "materials": { "shadow_fiend_base_body": { "color": "…_color.webp", "masks": "…", "specular": "…", "normal": "…", "rimColor": [0.49, 0.8, 0.91] } },
  "lighting": { "light": { "angles": [55.4, 143.9, 0], "color": [234, 243, 254], "scale": 1.45 } },
  "effects": [{ "system": "particles/units/heroes/hero_nevermore/nevermore_ambient_glow", "owner": "hero" }],
  "systems": {}, "textures": {}, "snapshots": {}, "attachments": {}
}
```

## License

The code is [MIT](LICENSE) (see also [NOTICE](NOTICE)). Models, textures, animations, particle systems and texts in
`assets/heroes/` come from Dota 2 and belong to Valve Corporation; they are not covered by the MIT
license. Dota 2 is a trademark of Valve; this project is not affiliated with Valve.

---

### По-русски

Loadout — все герои Dota 2 в браузере на three.js: игровой шейдер героя, свет со страницы героя, анимации и
частицы. Код открыт под MIT, ассеты принадлежат Valve. Демо: https://loadout.nyan.cafe/. Пересобрать героев
после патча: `tools/extract-dota.cmd` на Windows с установленной Dota, затем
`npm run heroes -- --zip <архив>`. Косметика: `node tools/fetch-dota.mjs` качает файлы игры из Steam,
`node tools/build-items.mjs` собирает предметы, `node tools/update.mjs` после патча берёт новое и выкладывает
(на сервере раз в сутки, `loadout-update.timer`; подробности выше, в Cosmetics).
