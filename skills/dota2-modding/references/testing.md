# Testing a mod

Check in this order, cheapest first. Each step catches what the one before cannot, and each round
trip through the user costs them a game launch.

## 1. The doctor (seconds, no game)

```
npm run doctor -- my_mod.vpk
```

It reads the mod against the game's files and reports, with what the player would see:

- a model whose animation plays only with an activity modifier an item turns on (the hero stands
  still or plays the wrong clip without the item);
- a model whose sequence numbers differ from the game's model at that path (online, every
  animation after that number is wrong);
- a particle that hangs more children on itself than it hands control points to (the extra ones
  draw at the hero's feet or its first attachment);
- a particle child that neither the mod nor the game has, or that the file's reference list
  leaves out.

Fix every error and warning. It exits with 1 on an error, so scripts can stop on it.

## 2. A render (minutes, no game)

Blender with the compiled parts and the hero's armature, posed on the clips that matter, lit and
filmed the way the game does: EEVEE, the camera high behind the hero looking down steeply (the
game's sits 1134 units away), no back faces drawn (the game does not draw the inside of a hood), and the
body's translucency applied (parts you hid must be gone). A render like that found the hole under
the Scream mask before the game did. Render the front too: the game camera never shows the face.

Machine checks beat eyes for geometry: pose the model on a dozen clips and shoot rays
([custom-models.md](custom-models.md): clipping and holes).

## 3. The bench (about three minutes, takes over the computer)

```
npm run dota:bench -- --vpk my_mod.vpk --hero <hero>
```

It installs the mod through the app's own installer, starts Dota into the hero demo with your
hero, and plays a scenario while it takes pictures: level 30 with Aghanim's Scepter and Shard, the
ability icons, the hero up close in the inspect view turned around, a target dummy and an enemy
hero, the attack from afar and close, every ability, and a walk across the screen and back. Then
it closes Dota, copies the console log and removes the mod.

| Option | For |
|---|---|
| `--short` | stop after the attack |
| `--skills "q,w,r@enemy"` | which abilities, `@enemy` aims at the enemy hero |
| `--camera 700` | camera distance (closer than the game's 1134) |
| `--idle-seconds 12` | film a long idle from the front in the inspect view (a gesture every few loops) |
| `--spawn` | kill the hero and film the respawn |
| `--death` | film the death in slow motion |
| `--now` | start although someone used the mouse in the last two minutes (only with the owner's yes) |
| no `--vpk` | the game as it is, to compare |

**Ask first, every time.** The bench moves the mouse, presses keys and fills the screen for about
three minutes. It refuses to start while Dota runs or while someone used the computer in the last
two minutes. A party invite from a stranger once covered the screen; the bench declines invites
now.

Read the results:

- `verdict.json` says whether the hero swings through its attacks. On dark models it reports "does
  not swing" when it does (the motion barely changes the pixels): look at the attack frames.
- the pictures, in order; compare with a run without `--vpk` before calling anything broken;
- `console.log` (the game runs with `-condebug`): errors about your files' paths, sounds and
  materials.

The bench camera is high and behind. A gesture in front of the face shows only in the inspect
frames or a render.

## 4. Find the cause, not a fix

When something looks wrong in the game, build test versions that each isolate one cause:

- **Flat colours per part** (`TAG` build): give every texture a flat, distinct colour. The Scream
  "bluish dotted line on the throat" was the body's own texels showing through; nothing else
  could have shown that.
- **Swap one block or one file for Valve's** and see if the problem goes. The head that turned
  backwards on the run was found by halving: Valve's whole ANIM fixed it, Valve's run clip alone
  did not, so it was the turns layer.
- **Compare with the plain hero** (`--hero` without `--vpk`): Aghanim's blue sparks on Necrophos
  came from Valve's shared Scepter effect, present on every hero.

## 5. The user

Show pictures of the final version with what is not checked yet, and ask what to change. A big
set goes as one report at the end of each step, not one message per fix.
