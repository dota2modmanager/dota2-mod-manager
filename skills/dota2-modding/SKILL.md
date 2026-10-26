---
name: dota2-modding
description: Make Dota 2 cosmetic mods with the user - recoloured hero effects, items and arcanas taken from the game's own files, custom hero sets with new 3D models, new animations, sounds, icons and hero-picker scenes - built, checked and packed into a VPK with Dota 2 Mod Manager's tools. Use whenever someone wants to create, change, fix or test a Dota 2 mod or skin, asks how Dota 2 mods work, or wants a hero to look, move or sound different.
---

# Making Dota 2 mods

You are helping someone make a cosmetic mod for Dota 2. Dota 2 Mod Manager
(https://github.com/dota2modmanager/dota2-mod-manager) installs mods and has the tools you need;
this skill tells you which tool does what, in what order, and where each kind of mod goes wrong.
Everything here was learned building real mods: Terrorblade's arcana from the game's files, and
"Scream", a full custom Necrophos set (new mask, hood, cloak, scythe, knife, red effects, new
idle, attack, spawn and run animations, sounds, icons, a hero-picker scene with a telephone).

## First, every session

1. **Find the repo.** You need a checkout of dota2-mod-manager and Node.js 24 (no `npm ci`: the
   modding commands use Node's own modules). If there is none, follow [SETUP.md](SETUP.md). Run
   every command below from the repo root.
2. **Check the computer:** `npm run modkit -- check`. It lists Node, Dota 2, the Workshop Tools,
   Source2Viewer (VRF), Blender and Python, and says how to get what is missing. Recolours and
   items from the game's files need only Node and Dota. Anything compiled (models, materials,
   textures, sounds, clips) needs the Workshop Tools, which exist for Windows only.
3. **Make a work folder** outside the game, such as `mods/<mod-name>/`, and keep every
   intermediate file there. Never write into `dota 2 beta/game/dota*` by hand.

## Find out what they want

Ask before building, one question at a time, and offer your recommendation with each. People
describe mods by how they look ("blood red", "like the TI arcana", "Ghostface"), so translate:

| They say | It is | Read | Needs |
|---|---|---|---|
| "make his spells red", "purple effects" | particle recolour | [recolor.md](references/recolor.md) | Node, Dota |
| "give me the arcana / immortal / set X" | item from the game's files | [items-from-game.md](references/items-from-game.md) | Node, Dota |
| "black body", "gold weapon", "hide the shoulders" | material and texture edits | [recolor.md](references/recolor.md), [custom-models.md](references/custom-models.md) | + Workshop Tools, Python |
| "a mask / hood / new weapon / a whole new look" | custom models | [custom-models.md](references/custom-models.md) | + Blender, VRF |
| "he should pull a knife", "new idle / attack / spawn" | animation clips | [animations.md](references/animations.md) | + Workshop Tools, Blender, VRF, Python |
| "scream when he casts", "new voice" | sounds | [sounds.md](references/sounds.md) | + Workshop Tools |
| "red ability icons", "my own portrait", "hover video" | UI pictures | [ui-pictures.md](references/ui-pictures.md) | + Workshop Tools, VRF, Python |

Then pin down: the hero; every change, as a list they confirm; what it should look like
(pictures, an existing skin to start from); where it must look right (in a match, close up in the
inspect view, in the hero picker); and whether they will share it, which brings in licences
([sharing.md](references/sharing.md)). A big set goes in steps: effects first, then models, then
motion, then sound and pictures, each one shown and approved before the next.

## The loop for every change

1. **Plan** with the game's own data, not memory: `npm run item-plan -- "<item>"` for an item,
   `npm run modkit -- find <words>` for paths, `modkit model <hero>` for animations,
   `modkit sounds <hero>` for sound events, `modkit pictures <hero>` for icons.
2. **Build** in the work folder: recolour, decompile and edit, model in Blender, compile with
   `npm run modkit -- compile <addon>`. Clips, sounds and pictures have their own commands
   (`modkit clips`, `modkit sounds`, `modkit pictures`) that compile and repair in one go.
3. **Pack:** `npm run modkit -- pack <folder> --out <mod>.vpk`. It leaves out files the game
   already has.
4. **Check without the game:** `npm run doctor -- <mod>.vpk`. Fix everything it reports.
5. **Look at it.** Render the model in Blender the way the game draws it, and when the user agrees
   to hand over the computer for three minutes, `npm run dota:bench -- --vpk <mod>.vpk --hero <hero>`
   films it in the game ([testing.md](references/testing.md)).
6. **Show the user** pictures of the result, say what is not checked yet, and ask what to change.
7. **Install:** the user drags the VPK into Dota 2 Mod Manager (My mods). It picks a slot, keeps
   the mod across patches and switches it off in one click.

## Rules that save days

- **A mod replaces files; it never adds them.** The game loads what its own files name. A new
  model goes under the stock path of the slot it replaces, a new particle under the path of the
  one it replaces, a new clip in place of an existing clip. A mod cannot add a sequence, an
  ability, an item or a sound event the game does not ask for.
- **Only you see it.** Mods change your game client. Other players see the default hero.
- **Ship only what you changed.** A compiled copy of a shared texture in your VPK replaces it for
  every hero. `modkit pack` leaves those out; keep one on purpose with `--keep <path>`.
- **Check before you show.** The doctor first, then a render or the bench. Each round trip
  through the user costs them a game launch.
- **The bench takes over the mouse and keyboard** for about three minutes and starts Dota. Ask
  first, every time, and do not run it while they are using the computer.
- **Decompile, do not guess.** Read what Valve's file says (Source2Viewer) before writing your own.
  The decompile is not perfect either: animations lose activity modifiers, bones change order
  (see [animations.md](references/animations.md)).
- **Measure, do not eyeball.** When something looks wrong in the game, build a test version that
  isolates one cause (flat colours per part, one block swapped) instead of trying fixes in a row.
  [pitfalls.md](references/pitfalls.md) lists each trap with what it looked like and the cause.
- **Credit and licences.** Models from Sketchfab or elsewhere need a licence that allows it
  (CC BY: name the author, link, licence, what you changed). Famous characters are trademarks.

## Reference

- [how-mods-work.md](references/how-mods-work.md): VPK, pak slots, the language folder, compiled
  resources, paths, what the game reads from where.
- [tools.md](references/tools.md): installing and using every tool, with the exact commands.
- [recolor.md](references/recolor.md): effects, materials, textures, icons in another colour.
- [items-from-game.md](references/items-from-game.md): arcanas, immortals and sets the player does
  not own, built from the game's files.
- [custom-models.md](references/custom-models.md): Blender to the game, slots, materials, hiding
  parts of the hero, cloth over the body, no holes and no clipping.
- [animations.md](references/animations.md): clips out of the game, edited, compiled and put back.
- [sounds.md](references/sounds.md): new sounds and sound events, in a match and in the hero picker.
- [ui-pictures.md](references/ui-pictures.md): ability icons, portraits, minimap, hover video.
- [testing.md](references/testing.md): doctor, bench, renders, A/B builds.
- [pitfalls.md](references/pitfalls.md): every trap met so far.
- [sharing.md](references/sharing.md): credits, licences, the catalog.
- [scripts/](scripts/README.md): Python helpers for FBX export, vmdl files and animation clips.
