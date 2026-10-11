# Building an item as a mod from the game's files

A player who does not own an item can still see it: the item's models, particles and pictures are
already in their game's `pak01`, and a mod can put them under the names the plain hero uses. This
page is how to build one, what the game does with each part, and where it went wrong the first
time. The worked example is Terrorblade's arcana, Fractal Horns of Inner Abysm
([#118](https://github.com/dota2modmanager/dota2-mod-manager/issues/118), `src/arcana.ts`). It took
two days, most of them on two traps that the tools below now catch in seconds.

## The loop

1. **Plan.** `npm run item-plan -- "<item name>"` (or its id) reads the item's `visuals` from
   `items_game` and lists every change it makes, how a build gives it, and whether the code
   already does (`src/item-visuals.ts`). Sounds, the kill effect and voice lines come with the item
   at play time; the plan says so instead of leaving you to find out.
2. **Build.** An item is a set in `src/arcana.ts` (`ARCANA_SETS`: models, pictures, the particle
   that hosts what the item creates) and `src/recolor.ts` (`RECOLOR_SETS`: the folders whose colour
   follows the gem). `npm run recolor -- <colour> --arcana` writes the VPK.
3. **Check without the game.** `npm run doctor -- <mod_dir.vpk>` (`src/mod-doctor.ts`) reads the
   mod against `pak01`: animations that need a modifier only the item switches on, in the clips
   and in the sequences; a particle child that is missing or drawn on another attachment than it
   is made for. It takes seconds.
4. **Check in the game.** `npm run dota:bench -- --vpk <mod_dir.vpk> --short` (Windows, Steam
   running, Dota closed) puts the mod in a free slot, starts hero demo, levels the hero, sets it on
   a dummy and takes 16 pictures 80 ms apart through the attack. `verdict.json` says whether the
   attack swings (`tools/dota-bench/verdict.mjs`); look at the pictures for the rest. About three
   minutes a build. Without `--short` it also presses Metamorphosis and Conjure Image.
5. **Compare.** Run the bench on the plain hero (`--hero terrorblade`, no `--vpk`) and on a mod of
   the same item from the catalog that works. When yours does not, swap resource blocks between
   the two (`resourceBlock(file, 'ANIM').replace(...)`) and bench each: the block that carries the
   difference turns up in two or three runs. That is how the attack bug was found.

## How an item reaches the screen

**The item's visuals.** Each `asset_modifier` in the item's `visuals` block is one change made
while it is worn:

| type | what it does | a build from files |
|---|---|---|
| `entity_model` | the hero's own model becomes another | put that model under the hero's model path |
| `activity` | switches an activity modifier on (`abysm`) | take the modifier off the swapped model's animations (below) |
| `model` | one wearable model becomes another | put the new one under the old path |
| `particle` | one particle becomes another | put the new one under the old path; its children keep their paths |
| `particle_create` | the item creates a particle | nothing creates it: hang it as a child of a particle the hero always has |
| `ability_icon`, `icon_replacement_hero*` | pictures | put them under the plain names in `panorama/images` |
| `sound` | another sound event plays | not tried yet |
| `custom_kill_effect`, `chatwheel`, `response_criteria`, `arcana_level` | game logic | a mod cannot give it |

The item's own `model_player` takes the place of the free item of its slot for that hero (the
arcana's horns under `horns.vmdl`).

**Load order.** A built item goes in as a hero item, which the app loads from slots 02-29, above
the catalog's hero mods at 30 and up: an arcana mod from the catalog does not cover the colour.

**Resources.** A compiled file (`*_c`) is a header and a table of blocks: `DATA`, `RERL` (the
resources it names), and for a model `ANIM`, `ASEQ`, `AGRP`, `MRPH`, `CTRL` and the mesh blocks.
`src/resource.ts` replaces a block and moves the later ones, each start aligned to 16 bytes. A RERL
entry's id is MurmurHash64B of the path, seed `0xEDABCDEF`.

**KV3** (`src/kv3.ts`, `src/kv3-write.ts`). The blocks are binary KV3, versions 1 to 5,
compressed with LZ4 or (version 5, a model's `ANIM`) zstd. Version 5 keeps the strings in the
first buffer and the values in the second; elements of a type-25 array sit in the first. Rules the
writer keeps: a typed array stays typed and its element type is kept; arrays with a one-byte
length (24, 25) go out as type 10; an empty typed array goes out plain, since Valve never writes
one and ValveResourceFormat refuses it. The writer's output is accepted by the game: a working
mod's blocks put through it play as before. It stores everything uncompressed, so a rewritten
animation block doubles in size.

**The gem's colour.** An arcana's colour is a prismatic gem (Terrorblade's: Reflection's Shade,
`#FF3C28`, `items_game` colors `unusual_terrorblade_abysm`). The game gives it to particles as
control point 15 (strength in control point 16) and to materials as `$GemColor`.
- A particle takes it with `C_INIT_RemapCPtoVector` / `C_OP_RemapCPtoVector` from CP 15 into the
  colour field (6): set (the default) or `PARTICLE_SET_SCALE_INITIAL_VALUE`. Seventeen of
  Terrorblade's particles have more than one, and the last to run wins: initializers in order,
  then operators. For a player who owns the item, the build scales each tint's range by chosen /
  gem. For one who does not, there is no gem and CP 16 is 0, so the build writes into the starting
  colours what all the tints would have made of them (`bakeTint`), bringing a colour over 255 down
  whole so its hue stays.
- A material reads it in a VfxEval expression, `exists($GemColor) ? $GemColor : float3(...)`. The
  build replaces the read with a constant (`src/material.ts`): the attribute's token is MurmurHash2
  of the lowercased name, seed `0x31415926`; opcodes 0x19 ATTRIBUTE, 0x1F EXISTS, 0x04 BRANCH,
  0x02 JUMP, 0x07 FLOAT, 0x06 FUNC, 0x00 RETURN, and every jump after a change moves with it.

**Particles that the item creates.** A particle hands its children control points one by one
(`C_OP_SetParentControlPointsToChildCP`, `m_nNumControlPoints`) and binds them to attachments in
`m_controlPointConfigurations[0].m_drivers`. A child added past that count gets the parent's first
point; the arcana's chest glow sat on the right eye until it got a point of its own on
`attach_hitloc` (`withChildren`).

**Animations.** A model lists, for every animation, the activity it plays (`ACT_DOTA_ATTACK`) and
the modifiers it needs, twice: on each animation clip (`ANIM`, `m_animArray[].m_activityArray`)
and on each sequence (`ASEQ`, `m_localS1SeqDescArray[].m_activityArray`). **The game picks by the
clips.** The first `ACT_*` entry is the activity and every other entry a modifier, the same
activity named again included. A model swapped in for a hero who lacks the item has to lose the
item's modifier from both lists, by taking the entry out (`asModel`); the plain animations beside
them lose that activity, which is what the game chooses when the modifier is on.

## Traps, and what catches each now

| trap | what it looked like | caught by |
|---|---|---|
| a child particle on its parent's first control point | a glowing ball in front of the face | doctor |
| only the first of a particle's gem tints baked | blades brown in red, blue in pink | test in `test/arcana.test.ts` |
| the item's modifier left on the animation clips | the hero stood still while its hits landed | doctor (clips), bench verdict |
| the modifier's entry pointed at the activity instead of taken out | the same | doctor |
| an empty typed array written typed | the hero and its items one flat colour | writer test |
| fixing the sequences when the game reads the clips | a day of builds that changed nothing | this page |
| a search over a model's blocks that skipped what it could not read | the clips (zstd) never looked at | the reader reads zstd |
| one picture a second, read by eye | a fidget at rest taken for the attack | burst and verdict |

Not settled yet: whether a swapped model's sequences in another order than the hero's cause wrong
animations online, where the server keeps the plain model. The doctor warns about it.
