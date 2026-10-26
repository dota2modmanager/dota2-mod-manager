# Tools

`npm run modkit -- check` tells you which of these are installed. Commands below run from the
repo root unless they say otherwise.

## modkit (this repo, Node only)

| Command | Does |
|---|---|
| `npm run modkit -- check [--json]` | lists the tools and how to install the missing ones |
| `npm run modkit -- find <words...> [--ext vmdl_c] [--limit 200]` | paths in the game's pak01 holding every word |
| `npm run modkit -- extract <path or folder>... --out <dir>` | copies the game's compiled files out as they are |
| `npm run modkit -- recolor <hero> <colour> --out <dir> [--include <folder>]... [--one-pass]` | a hero's particles and status effects in a colour, compiled |
| `npm run modkit -- compile <addon> [source...] [--dry-run]` | Valve's compiler on `content/dota_addons/<addon>/`; output in `game/dota_addons/<addon>/` |
| `npm run modkit -- pack <dir> --out <mod.vpk> [--keep <path>]...` | a folder of compiled files as one VPK, without the game's own files |
| `npm run modkit -- model <hero> [--out model.json]` | the hero model's bones and sequences: number, activity, modifiers, clips ([animations.md](animations.md)) |
| `npm run modkit -- clips <compiled.vmdl_c> --hero <hero> --out <dir>` | your compiled clips moved into Valve's model, checked and repaired |
| `npm run modkit -- sounds <hero> [--vo] [--show <event>]` | a hero's sound events; with `--addon --out` and `--replace`/`--layer`/`--add Event=file.wav` compiled with yours ([sounds.md](sounds.md)) |
| `npm run modkit -- pictures <hero> --out <dir>` | icons, portraits and the minimap sheet as PNG; with `--from <dir> --addon` the edited ones compiled back ([ui-pictures.md](ui-pictures.md)) |

Every command takes `--game "<...>/dota 2 beta/game"`. Without it, modkit uses the folder from
the app's settings, then searches Steam's libraries. A colour is `190,6,6` or `#be0606`. A hero
is the game's name (`necrolyte`) or the display name in quotes (`"Necrophos"`).

## Other repo tools

| Command | Does |
|---|---|
| `npm run item-plan -- "<item name or id>"` | what an item changes, from `items_game`: models, particles, activity modifiers, icons, and which of them a mod can give |
| `npm run doctor -- <mod.vpk>` | checks a mod against the game in seconds: animations needing a modifier an item turns on, sequence numbers that differ from the game's, particle children on the wrong control point ([testing.md](testing.md)) |
| `npm run dota:bench -- --vpk <mod.vpk> --hero <hero>` | starts Dota, shows the hero in demo mode and films it (see [testing.md](testing.md)) |
| `npm run recolor -- <colour> --arcana` | Terrorblade's arcana in a colour; the worked example of an item build |

The app itself also packs a folder of loose files when you drag the folder in. With the Workshop
Tools installed it can also rebuild the items of an "unsafe" mod through the compiler, so they
survive a reconnect (Settings).

## Source2Viewer CLI (ValveResourceFormat)

Download `Source2Viewer-CLI` from
https://github.com/ValveResourceFormat/ValveResourceFormat/releases. Set `VRF_CLI` to its path or
put it on PATH. `PAK` below is `<game>/dota/pak01_dir.vpk`.

```
# list files
Source2Viewer-CLI -i PAK -l -f models/heroes/necrolyte/

# decompile a folder into editable sources (.vmdl, .vmat, .vpcf, .dmx clips, .png textures)
Source2Viewer-CLI -i PAK -f models/heroes/necrolyte/ -o work/decomp -d
Source2Viewer-CLI -i PAK -f materials/models/heroes/necrolyte/ -o work/decomp -d

# a model as glTF with its skeleton and clips, for Blender
Source2Viewer-CLI -i PAK -f models/heroes/necrolyte/necrolyte.vmdl_c -o work/necrolyte.glb -d \
  --gltf_export_format glb --gltf_export_materials --gltf_export_animations

# print one block of a compiled file (DATA, RERL, ANIM...)
Source2Viewer-CLI -i work/raw/models/heroes/necrolyte/necrolyte.vmdl_c -b ASEQ
```

Without `--gltf_export_animations` the glb has no skeleton. Decompiled models leave out activity
modifiers and may list bones in another order ([animations.md](animations.md)).

## Blender

Blender 4.2 or newer (the Scream set used 5.2). Run scripts without the window:

```
blender -b scene.blend --python script.py -- arg1 arg2
```

Arguments after `--` reach the script as `sys.argv[sys.argv.index("--") + 1:]`. Render with EEVEE
for quick checks.

Every step in this skill brings game models into Blender as a glb from Source2Viewer, through
Blender's own glTF import; that is the export the bone order and axes here were checked against.
You do not need SourceIO (https://github.com/REDxEYE/SourceIO). Suggest it only when the person
wants to open `.vmdl_c` files in Blender by hand.

Units: the glb is in Source units x 0.0254 (metres); the hero faces -Y. FBX for the compiler goes
out at 1/0.0254 with `import_scale = 0.01` in the vmdl (`scripts/export_fbx.py`).

## Workshop Tools (resourcecompiler)

Steam > Dota 2 > Properties > DLC > Dota 2 Workshop Tools. The compiler is
`<game>/bin/win64/resourcecompiler.exe`. It compiles sources under
`<install>/content/dota_addons/<addon>/` into `<install>/game/dota_addons/<addon>/` with the same
relative paths. Neither folder is mounted by the game, so compiling cannot break it.

```
resourcecompiler.exe -nop4 -f -game "<game>/dota" -i <source file> [-i <another>...]
```

- `-f` forces a rebuild; without it the compiler skips files it thinks unchanged.
- `-r` follows references: compiling a `.css` that names pictures compiles the pictures
  ([ui-pictures.md](ui-pictures.md)).
- Run it from `bin/win64`. `modkit compile` does all of this.
- Read its output for `ERROR` and `failed`. A model that fails names the line of the vmdl.

## Python

Python 3.11+ with Pillow and numpy for textures and the helper scripts in `scripts/`. Run your
own scripts with `-I` when they read files you downloaded, so a planted module next to them
cannot load.
