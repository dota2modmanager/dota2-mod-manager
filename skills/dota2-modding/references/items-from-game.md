# Items from the game's own files

A player who does not own an item can still see it: its models, particles and pictures already sit
in their `pak01`. The mod puts them under the names the plain hero uses. The full mechanics, with
Terrorblade's arcana as the worked example, are in the repo's `docs/item-mods.md`; read it before
the first item. This page is the order of work.

## Before you start

Dota 2 Mod Manager already installs arcanas and item sets from its own builder in the app, with
hand-rebuilt bases for the arcanas that broke when built from the game's files
(`src/arcana-bases.ts`). Ask the user to check the app first, and build by hand only what it does
not offer.

## Order of work

1. **Plan, a minute:** `npm run item-plan -- "<item name>"`. It reads the item's `visuals` from
   `items_game` and prints every change, how a build gives it, and what a mod cannot give (kill
   effects, voice lines, chat wheel). Do not read `items_game` by hand.
2. **Build.** Each visual becomes a file at a stock path:

   | Visual | In a mod |
   |---|---|
   | `entity_model` (the hero becomes another model) | that model under the hero's model path |
   | `model` (a slot model becomes another) | the new model under the stock slot path |
   | `particle` (one effect becomes another) | the new particle under the old one's path |
   | `particle_create` (the item creates an effect) | nothing creates it: hang it as a child of a particle the hero always has |
   | `activity` (an activity modifier, e.g. `abysm`) | take the modifier off the swapped model's clips |
   | `ability_icon`, `icon_replacement_hero*` | the pictures under the plain names in `panorama/images` |

   In the repo an item is a set in `src/arcana.ts` (`ARCANA_SETS`) with helpers for each row:
   `withChildren` (hang created particles on a host, each on its own control point), `asModel`
   (drop the item's modifier from clips and sequences), `bakeTint` (gem colours written in).
3. **Doctor:** `npm run doctor -- <mod.vpk>`. Nothing may be reported.
4. **Bench:** `npm run dota:bench -- --vpk <mod.vpk> --hero <hero> --short`, then read
   `verdict.json` (`swings: true` means the attack animation plays).

## An immortal or set without the item

The Scream set took four Necrophos immortals (scythe, head, shoulders, legs) and gave the plain
hero their behaviour:

- their ability particles under the stock paths, their own folders recoloured;
- their ambient effects hung as children of `necrolyte_ambient_glow`, which the hero always
  creates. Ambients bound to attachment points that exist only on the item's own model (a palm, a
  horn) cannot attach to another model: leave them out or give your model those attachments;
- their animations (the `immosh` modifier) played without the item. **Keep every activity and
  modifier Valve's model has on the sequences the server can pick without the item**, and make the
  plain sequence play the item's clips: copy everything of the `immosh` sequence but its name and
  activities onto the plain one whose other entries match (`idle_anim` plays what
  `immosh_idle_anim` plays). Online the server picks by Valve's model and sends a number; the
  first Scream build took the activity off the plain idle instead, which looked right in demo
  mode, and in a real lobby the hero stood in the injured idle at full health. Only an item
  sequence with no plain twin (the menu's `immosh_loadout`) loses the modifier: the server never
  picks it, and the menu picks on the client. The doctor warns when a pickable sequence changed;
- the scythe's sound layer added to the plain cast event ([sounds.md](sounds.md)).

## Gem colours (prismatic arcanas)

The game gives a gem's colour to particles as control point 15 (`C_INIT_RemapCPtoVector` /
`C_OP_RemapCPtoVector` into the colour field) and to materials as `$GemColor` in a VfxEval
expression. For a player without the item the gem is absent: bake the colour into the particles'
starting colours (`bakeTint`) and replace the material's read with a constant
(`src/material.ts`). A particle can carry several tints; all of them apply in order, initializers
first, and the last one wins.

## Traps met on items

- The game picks animations by the **clips** (`ANIM`, `m_animArray[].m_activityArray`), not the
  sequences. Fixing only `ASEQ` changes nothing.
- A modifier entry must be removed, not pointed at the activity: a repeated activity counts as a
  modifier.
- A particle child past the parent's `m_nNumControlPoints` sits on the parent's first point: an
  arcana's chest glow sat on the right eye.
- Name the stock path, never the paid one: a match loads what the server's item table names, and
  after a reconnect a paid model path shows as an ERROR model.
- Check the plain hero first: Terrorblade's Metamorphosis glitched without any mod too.
