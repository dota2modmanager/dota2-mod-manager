# Interface pictures

Besides the model, the game shows a hero through its ability icons, three portraits (top bar,
small icon, picker card), a minimap icon and a short video when you hover the card. All of them
are files under fixed paths, so a mod replaces them like anything else.

| Picture | Path in the game | Size |
|---|---|---|
| Ability icon | `panorama/images/spellicons/<hero>_<ability>_png.vtex_c` | 128x128 |
| Top bar, scoreboard | `panorama/images/heroes/npc_dota_hero_<hero>_png.vtex_c` | 128x72 |
| Small icon (health bar, lists) | `panorama/images/heroes/icons/npc_dota_hero_<hero>_png.vtex_c` | 32x32 |
| Hero picker card | `panorama/images/heroes/selection/npc_dota_hero_<hero>_png.vtex_c` | 142x188 |
| Minimap | one cell of `materials/vgui/hud/minimap_hero_sheet` | 32x32 |
| Hover video | `panorama/videos/heroes/npc_dota_hero_<hero>.webm` | 256x256, 30 fps, 4 s loop |

Draw at double size and scale down for sharper edges; keep the alpha of the originals.

## Out and back in

```
npm run modkit -- pictures <hero> --out work/pics
# edit the PNGs in place, add work/pics/minimap.png (32x32) and the .webm if you have them
npm run modkit -- pictures <hero> --from work/pics --addon my_mod --out work/mod
```

The first command writes every picture as PNG under its game path, plus the whole minimap sheet
and a list of fingerprints; the second compiles only the PNGs you changed. Most interface pictures
are block-compressed and need Source2Viewer to come out.

How it works, for when you do it by hand: panorama's compiler builds a picture only when a
stylesheet names it. The command writes a stylesheet with a `background-image:
url("file://{images}/...")` line per picture, compiles it with `resourcecompiler -r`, and keeps
only the compiled pictures. The stylesheet itself stays out of the mod.

## Recolour icons

Pillow and numpy: for each pixel take max and min of RGB; saturation `(max-min)/max`; keep
greys (saturation under ~0.1) as they are; give coloured pixels the target hue with saturation
pushed up (x1.6) and the brightness kept. The Scream set started from the immortal versions of the
icons where Necrophos has one (`panorama/images/spellicons/necrolyte/...`): put them under the
plain names.

## The minimap

The minimap cuts every hero out of one sheet. `scripts/mod_textures.txt` gives the cell
(Necrophos: 0,64, 32x32). A material of your own on `ui.vfx` did not work: the compiler ignored
`TextureColor`. What works: Valve's sheet with your icon pasted into the cell, compiled and packed
under the name of Valve's texture (`minimap_hero_sheet_psd_3529892a.vtex_c`). `modkit pictures`
does exactly that. Two mods that both change minimap icons conflict: the last one wins.

## Portraits and the video

Render the hero in Blender, not a screenshot: a transparent background, a key light from the
front, a rim light in the mod's colour, then composite on a background. Crop like Valve's (top of
the head cut off on the card, shoulders up on the top bar). The card's lower edge is covered by the
name plate and its sides are cut.

Render with the mod's textures. With Valve's body texture under your mask, the Scream icons showed
the green Necrophos head through the mask's eyes.

The hover video: 120 frames of the menu pose (the end of `loadout_spawn` or the `loadout` clip),
composited the same way, encoded as WebM VP9 with Blender's FFmpeg output (Blender 5: set the
output's media type to video first; view transform "Standard" so the frames are not tone-mapped).
The game takes the `.webm` as it is; `modkit pictures` copies it into the mod.

## The catalog card

For sharing: a 1280x720 picture of the mod, the hero large, readable at thumbnail size. Show the
result in the game's light or a render that matches it; a glowing blade renders dark in a plain
Blender scene.
