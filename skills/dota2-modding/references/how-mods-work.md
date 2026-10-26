# How a Dota 2 mod reaches the screen

## The files

Dota 2 keeps its assets in VPK archives. The base game is `game/dota/pak01_dir.vpk` (an index)
plus `pak01_000.vpk ... pak01_NNN.vpk` (the data). Inside, every file has a path such as
`models/heroes/necrolyte/necrolyte.vmdl_c`. The `_c` means compiled: Source 2 resources are
binary files built from text or image sources (`.vmdl` model, `.vmat` material, `.vpcf`
particle, `.vtex` texture, `.vsndevts` sound events, `.vsnd` sound) by Valve's resourcecompiler.

A mod is a VPK holding compiled files at the same paths as the game's. When both have a path, the
game reads the mod's.

## Where mods go

The game mounts extra folders before `game/dota`. Dota 2 Mod Manager uses the language folder:
`game/dota_<language>/pakNN_dir.vpk`, with the game started in that language. Rules measured on the
live game:

- The game mounts only `pakNN_dir.vpk` with NN a number from 01 to 99. `pak00` is never mounted.
- A lower number wins when two paks carry the same path. Gaps in the numbering are fine.
- In an official language folder (`dota_russian`), `pak01` is Valve's voice-over; mods take other
  slots.
- One file is read from `game/dota` only: `scripts/items/items_game.txt`.
- A file renamed to `*.vpk.off` is skipped; the app switches mods off that way.

Let the app place mods: drag the VPK into My mods. It picks a free slot, reports when two mods
carry the same file, and restores mods after a Dota patch. To see what the game mounted, start Dota
with `-condebug` and read the `[Filesystem]` section of `game/dota/console.log`.

## Paths you will replace

| What | Path pattern |
|---|---|
| The hero's body and animations | `models/heroes/<hero>/<hero>.vmdl_c` |
| The default item in a slot | `models/heroes/<hero>/<slot>.vmdl_c` (weapon, head, shoulders, back...) |
| Materials and textures | `materials/models/heroes/<hero>/...` |
| The hero's effects | `particles/units/heroes/hero_<hero>/...vpcf_c` |
| Status effects (tint on the hero) | `particles/status_fx/status_effect_<name>.vpcf_c` |
| Sound events | `soundevents/game_sounds_heroes/game_sounds_<hero>.vsndevts_c` |
| Voice lines and the hero picker's sounds | `soundevents/voscripts/game_sounds_vo_<hero>.vsndevts_c` |
| Ability icons | `panorama/images/spellicons/<ability>_png.vtex_c` |
| Hero pictures | `panorama/images/heroes/`, `.../icons/`, `.../selection/` |
| Hover video in the hero grid | `panorama/videos/heroes/npc_dota_hero_<hero>.webm` |

`<hero>` is the game's internal name, which differs from the display name for many heroes:
necrolyte (Necrophos), nevermore (Shadow Fiend), zuus (Zeus), furion (Nature's Prophet),
skeleton_king (Wraith King), queenofpain, rattletrap (Clockwerk), wisp (Io). `npm run modkit --
find <word>` finds the real paths.

The slot names come from the hero's default items: `npm run modkit -- find models/heroes/<hero>/
vmdl_c` lists them. A slot item is a model with the hero's skeleton (or a subset), so a new model
in that slot moves with the hero.

## What the game reads from where

- **Animations are chosen by number online.** The server picks a sequence by its index in its own
  copy of the model. Your model must keep Valve's sequences in Valve's order; you can change what
  a clip contains, never add one.
- **Items:** a paid item's visuals switch on activity modifiers, swap particles and create extra
  ones. A mod gives none of that through the item system; it puts the item's files under the
  plain hero's paths ([items-from-game.md](items-from-game.md)).
- **The hero picker and the hero page** play the clips with `ACT_DOTA_LOADOUT` and the spawn
  clips, and load the hero's voice-line sound file, not the hero's sound file.
- **The HUD portrait** draws the hero model with the camera from `scripts/npc/portraits.txt`.

## What a mod cannot do

Change gameplay, numbers, hitboxes, ability timing the server decides, or anything other players
see. Add new sounds the game does not trigger, new abilities, new sequences. Mods are cosmetic and
local to the player's client.

## Compiled resources, briefly

A `_c` file is a header and a table of blocks: `DATA` (the main KV3 data), `RERL` (resources it
references), and for models `ANIM` (clips), `ASEQ` (sequences), `AGRP` (animation group and decode
key), `MRPH`, `CTRL` and mesh blocks. KV3 is Valve's binary key-value format, versions 1 to 5,
compressed with LZ4 or zstd. The repo reads and writes all of it: `src/resource.ts`
(`resourceBlock(file, 'ANIM').replace(...)`), `src/kv3.ts`, `src/kv3-write.ts`. A RERL id is
MurmurHash64B of the path with seed `0xEDABCDEF`. Details: `docs/item-mods.md` in the repo.
