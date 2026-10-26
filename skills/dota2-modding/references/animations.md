# New animations

A hero's animations live inside its model, `models/heroes/<hero>/<hero>.vmdl_c`. You change them
by compiling the whole model again from Source2Viewer's decompile with your clips in place of
Valve's, then moving only the animation blocks of that compile into Valve's own model. The
Necrophos "Scream" set changed 14 clips this way: a knife drawn in the idle, a knife attack, a
throat-cut gesture on the ultimate, a rise from a pool of blood on spawn, a scythe dragged on the
run, a mask that falls off on death, and a hero-picker entrance with a telephone.

## What you can and cannot change

- **You replace clips. You never add or reorder them.** Online the server tells your client to
  play sequence number N of *its* copy of the model. A model with one sequence more or less plays
  the wrong animation from that number on. Replace what a sequence plays; keep every name.
- **Timing is part of the game.** An attack clip says when the projectile leaves (Necrophos'
  `attack_anim`: frame 10 of 28) and a cast clip when the spell fires (`cast_ult_anim`: 0.4 s).
  Keep the length and the moment of the hit. Change what the body does around it.
- **Two clips can share an activity.** Necrophos has two attacks (`attack_anim`,
  `attack1_anim`) and the game picks one at random; two ultimates (`cast_ult_anim`,
  `cast_ult_death_protest_anim`). Change both, or accept that it shows half the time.
- **Items switch clips.** An item adds an activity modifier and the game plays the clip tagged
  with it. A hero wearing Necrophos' immortal shoulders runs `immosh_run_anim`, not `run_anim`.
  Ask which items the user wears, and change the clip that actually plays.
- **Cloth bones ignore clips.** Bones in the model's cloth simulation (`PHYS.m_pFeModel`, on
  Necrophos every `beard_*` and `cape_*`) follow physics; the game ignores their tracks. To move a
  part of your own, put it on a free bone no default item uses and outside the cloth: the Scream
  mask went onto `scarf_0_R` (a child of `Spine_3`), the knife onto `scarf_0_L`.
- **The respawn flash covers the first 0.4 s** of `spawn_anim`. Start the visible motion after it.

## See what is there

```
npm run modkit -- model <hero> --out work/model.json
```

prints every sequence with its number, the activity that plays it, its modifiers and the clips it
plays, and saves the bones in Valve's order with the same list for `prepare_vmdl.py`. For Necrophos
it shows #15 `idle_anim` (ACT_DOTA_IDLE), #36 `immosh_idle_anim` (ACT_DOTA_IDLE + immosh), and #29
`cast_ghost_shroud` playing `@@cast_ghost_shroud`.

| Where the player sees it | Activity | Notes |
|---|---|---|
| Standing | ACT_DOTA_IDLE | loops; a long one plays its full length before it repeats |
| Moving | ACT_DOTA_RUN | turns are a separate layer of three poses (`@turns_lookFrame_0..2`) |
| Attack | ACT_DOTA_ATTACK | random between the clips that have it |
| Abilities | ACT_DOTA_CAST_ABILITY_1..6 | Q is 1, W 2, E 3, R 4 |
| Respawn, game start | ACT_DOTA_SPAWN | |
| Death | ACT_DOTA_DIE | |
| Hero page and hero picker | ACT_DOTA_SPAWN + loadout, then ACT_DOTA_LOADOUT | `loadout_spawn` is the entrance, `loadout` the pose after it |
| Hover video in the picker | none | a WebM file, see [ui-pictures.md](ui-pictures.md) |
| Victory screen | ACT_DOTA_VICTORY | |

## The pipeline

You need Source2Viewer, Blender, Python with numpy and the Workshop Tools (`npm run modkit -- check`).

### 1. Decompile the model and get a Blender file

```
Source2Viewer-CLI -i "<game>/dota/pak01_dir.vpk" -f models/heroes/<hero>/ -o work/decomp -d
Source2Viewer-CLI -i "<game>/dota/pak01_dir.vpk" -f models/heroes/<hero>/<hero>.vmdl_c -o work/<hero>.glb -d \
  --gltf_export_format glb --gltf_export_materials --gltf_export_animations
```

The first gives `work/decomp/models/heroes/<hero>/<hero>.vmdl` and one `<hero>_<clip>.dmx` per
clip. The second, imported in Blender (File > Import > glTF), gives the hero with its armature and
every clip as an action. Its rest pose is Valve's bind pose. Save it as `work/<hero>.blend`.

### 2. Make the clip in Blender

Start from Valve's action of the clip you replace (duplicate it). Animate on the armature as it
is: never rename, add or remove bones. Keep the clip's length and its key moments. Dota plays
clips at 30 fps; the glTF import keys at the scene's rate, and the export samples by time, so
either works.

Two kinds of edit cover most mods:

- **Change a pose over a stretch of frames** (head thrown back, an arm raised): key the bones on
  top of Valve's motion and blend in and out over 5 to 10 frames.
- **Hold a prop** (a knife on a free bone): compute the prop bone's matrix per frame from the hand
  or from where it hangs on the belt. Write that in Python against `rig.py` (below) instead of by
  hand: the Scream knife followed the hand through 14 clips, and every clip it does not appear in
  must still keep the bone on the belt.

### 3. Export the clip

```
python scripts/clip.py bind work/decomp/models/heroes/<hero>/<hero>_idle_anim.dmx work/bind.json
blender -b work/<hero>.blend --python scripts/pose.py -- export <action> work/bind.json work/clips/<clip>.json
python scripts/clip.py write work/decomp/models/heroes/<hero>/<hero>_<clip>.dmx work/clips/<clip>.json work/clips/<clip>.dmx
```

`pose.py` turns each frame into the local bone transforms a clip holds (inches, quaternion x y z
w). `clip.py write` puts them into Valve's own DMX for that clip, so everything else in the file
(face channels, events) stays. Round trip check: Valve's idle exported and written back differs
from the original by 0.0001 inch.

`clip.py info <clip.dmx>` prints frames, rate and bones; `dmx.py` reads and writes Valve's binary
DMX byte for byte; `rig.py` has forward kinematics, blending and IK helpers for clips written in
Python.

### 4. Prepare the vmdl and compile

Write `work/clips.json`:

```json
{
  "vmdl": "decomp/models/heroes/necrolyte/necrolyte.vmdl",
  "model": "model.json",
  "addon": "C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/content/dota_addons/my_clips",
  "clips": { "idle_anim": "clips/idle_anim.dmx", "immosh_idle_anim": "clips/idle_anim.dmx" },
  "move_last": ["sickle1"]
}
```

```
python scripts/prepare_vmdl.py work/clips.json
npm run modkit -- compile my_clips models/heroes/<hero>/<hero>.vmdl
```

`prepare_vmdl.py` repairs what the decompile gets wrong: it puts the activity modifiers back
(without them an item's clip plays at random in place of the plain one), moves `bindPose` to the
top of the animation list, moves the bones listed in `move_last` to the end of their siblings, and
points the clips you named at your DMX files. The compiler prints errors about the hero's
materials and textures: ignore them, only the animation blocks are used.

### 5. Put the clips into Valve's model

```
npm run modkit -- clips "<game>/dota_addons/my_clips/models/heroes/<hero>/<hero>.vmdl_c" --hero <hero> --out work/mod
```

It takes Valve's model from pak01 and replaces only its ANIM, ASEQ and AGRP blocks with yours,
after checking and repairing them:

| Check or repair | What went wrong in the Scream set without it |
|---|---|
| Animated bones in Valve's order | `sickle1` came first among `wrist_R`'s children and the fingers of the right hand played the sickle's track. The command names the bone to put in `move_last`. |
| Sequence names and numbers as Valve's | The decompile names the clip `@@cast_ghost_shroud` `cast_ghost_shroud`; every sequence from #30 was one number off online. Renamed back automatically. |
| Morph channel | The decompile has no morphs; without the channel the hero drew as a flat glow. Copied from Valve. |
| Blended sequences (`m_bMulti`) | The turns layer came out as a plain clip and the head spun round while running. Valve's fetch and flags copied. |
| Turn poses from Valve | The decompile hands over poses as differences from the bind pose; the compiler made whole poses of them, and the head turned backwards on the run. Valve's segments copied byte for byte. |
| Clips Valve has not got | The compiler adds `turns` and `immosh_turns` (the layer's source); the walk played them. They get the middle pose. |

It refuses with a message when something cannot be repaired. Then pack, doctor and look:

```
npm run modkit -- pack work/mod --out my_mod.vpk
npm run doctor -- my_mod.vpk
```

## Look before the game

Render the clip in Blender on your model (EEVEE, the camera where the game's is: high behind the
hero, about 60 degrees down) at the frames that matter. The bench films the game, but from above
and behind: a gesture in front of the face shows better in a render. Then the bench:
`--idle-seconds 12` films a long idle from the front in the inspect view, `--spawn` the rise,
`--death` the death in slow motion ([testing.md](testing.md)).

## Sounds on clips

A clip carries events: `AE_CL_PLAYSOUND` plays a sound event at a frame. `prepare_vmdl.py`'s
`"sounds": {"loadout_spawn": [[24, "Hero_X.Ring"], [134, "Hero_X.Yell"]]}` replaces the clip's
voice line (`AE_CL_SPEECH`) with your events, for an entrance whose own voice line would talk over
yours. The events must exist in a file the game loads at that moment: the hero picker loads only
the hero's voice file ([sounds.md](sounds.md)).

## Traps

- **KV3 types 26 and 27.** Valve's new compiler writes some numbers as these types; a writer that
  copies them wrong produces an ANIM the game silently ignores and the hero stands in the bind
  pose. The app's KV3 writer handles them since PR #336; use `modkit clips`, not your own writer.
- **A hero in the bind pose in the game** means the game rejected the animation blocks: run the
  doctor, then `modkit clips` again on a fresh compile.
- **A prop's own bind pose.** A weapon model with its own skeleton (`necrolyte_sickle`) has its
  own rest position for the shared bone. Compute a grip from the weapon's armature, not the
  hero's: computed from the hero's, the Scream scythe came out turned round in the hand.
- **The head turns backwards while running:** the turns layer. See the table above.
- **Compare with the plain hero.** `npm run dota:bench -- --hero <hero>` without a mod films
  Valve's version. Half of "is this broken?" questions end there.
