# Recolouring: effects, materials, textures, icons

## A hero's effects

```
npm run modkit -- recolor necrolyte 190,6,6 --out work/mod
npm run modkit -- pack work/mod --out necro_red.vpk
npm run doctor -- necro_red.vpk
```

This rewrites the colours written in the hero's particles (`particles/units/heroes/hero_<hero>/`
and `particles/status_fx/status_effect_<hero>*`). Add an item's folder with
`--include particles/econ/items/<hero>/<item>/`.

It works in two passes (`src/recolor.ts` `shade`). The first gives every colour the target's hue
and keeps its own saturation and brightness; the second scales saturation and brightness toward
the target. A single pass that rotates hues by one angle fails on heroes whose effects span
several hues: Necrophos' greens run from yellow-green to teal and came out purple and orange.
`--one-pass` exists for heroes with one hue. Colours with almost no saturation (white cores,
greys) stay as they are, which keeps the bright centres of effects bright.

Colours the recolour cannot reach:

- **Colours drawn in a texture.** A projected material (Necrophos' Ghost Shroud ring on the
  ground, `materials/particle/projected_spirit`) is a picture. Recolour the decompiled PNG (keep
  the brightness, change the hue) and compile it under the texture's own name through a `.vtex`
  source with DXT5 and all four channels (below). A `.vmat` of your own pointing at a PNG loses the
  alpha, and the ring becomes a square on the ground.
- **Colour warps.** A status effect may colour the model through a shared 3D lookup texture
  (`colorwarp_morphling1` serves eleven effects). Do not repaint the shared one: decompile the
  status effect `.vpcf`, point it at a lookup that already has your colour (Bloodseeker's
  `colorwarp_rupture` is red), compile it under the status effect's path.
- **Gem colours** of arcanas, which the game sets at play time ([items-from-game.md](items-from-game.md)).

What the recolour can make worse, seen on red:

- **Additive overbright clips to orange.** An additive renderer drawn at x3-x4 brightness over
  itself pushes red past white, with green rising first. Lower the overbright (x1.2-2), and remove
  the small green component from colours (184,44,44 drifts orange when clipped).
- **Additive red on green grass looks yellow.** Thin or remove wide additive haze layers.
- **MOD2X renderers multiply what is under them by twice their colour.** Pure red there zeroes the
  green and blue of the ground and fills the screen with red fog. Keep some green and blue in
  those colours.
- **Switching an additive layer to alpha blending** drew black squares: the textures have no alpha.

## Materials: body, weapon, hiding a part

Decompile the hero's materials (`Source2Viewer-CLI ... -f materials/models/heroes/<hero>/ -d`).
A `.vmat` is text. Copy it into your addon at the **same path**, change what you need, compile.
Useful keys of `hero.vfx`:

| Key | Use |
|---|---|
| `TextureColor` | the colour map; point it at your PNG |
| `TextureSelfIllumMask`, `g_flSelfIllumScale` | glow |
| `g_vBloomColor`, `g_flBloomScale` | the glow's bloom colour; `[0 0 0 0]` turns a hero's bloom off |
| `g_flSpecularExponent`, `g_flSpecularScale`, `g_flRimLightScale`, `g_vRimLightColor` | shine and rim light |
| `TextureTranslucency` + `F_ALPHA_TEST 1` | cut parts away: black texels are not drawn |
| `F_DETAIL 0` | switches off an animated detail layer (Necrophos' robe pattern) |
| `F_MASKS_1 1` with `TextureDetailMask`, `TextureDiffuseWarpMask`, `TextureMetalnessMask` | the packed masks; give the ones you do not paint a black PNG |

Remove the `"Compiled Textures"` block of a decompiled vmat before compiling it, and copy every
PNG it names into the addon. With `F_MASKS_1` on and a mask missing, the game took a mask for
metal and drew it black.

**Hiding the default item of a slot:** its material with a black `TextureTranslucency` and
`F_ALPHA_TEST 1`. **Hiding part of the body** (the head under your own mask): black out, in the
body's translucency map, the texels of the triangles that belong to that part, and leave texels
other triangles share. `scripts/uv_cut.py` does it from the UV triangles: it cuts every texel
inside the part's triangles plus a margin into the empty space around them. A margin alone is not
enough: where two UV islands lie close, their margins cancel out and leave stray texels of the
hidden part, which showed in the game as a dotted line across the throat
([pitfalls.md](pitfalls.md)).

## Textures

Recolour a texture with Pillow: convert to HSV, set the hue of coloured pixels, keep value, push
saturation; leave greys. Keep the size and format. Write it into the addon at the path the vmat
names and compile. Do not ship textures you did not change.

The `.vtex` for rebuilding a game texture under its own name with alpha:

```
<!-- dmx encoding keyvalues2_noids 1 format vtex 1 -->
"CDmeVtex"
{
    "m_inputTextureArray" "element_array"
    [ "CDmeInputTexture" { "m_name" "string" "InputTexture0"  "m_fileName" "string" "<png path in the addon>"
        "m_colorSpace" "string" "srgb"  "m_typeString" "string" "2D" } ]
    "m_outputTypeString" "string" "2D"
    "m_outputFormat" "string" "DXT5"
    "m_textureOutputChannelArray" "element_array"
    [ "CDmeTextureOutputChannel" { "m_inputTextureArray" "string_array" [ "InputTexture0" ]
        "m_srcChannels" "string" "rgba"  "m_dstChannels" "string" "rgba"
        "m_mipAlgorithm" "CDmeImageProcessor" { "m_algorithm" "string" "Box" }
        "m_outputColorSpace" "string" "srgb" } ]
}
```

Save it as `<the game's texture path without _c>` (for example
`materials/particle/projected_spirit_psd_b02c45b.vtex`), compile, and pack with
`--keep <that path>_c`.

## Ability icons

Icons are pictures in `panorama/images/spellicons/`. Extract and decompile them, change the hue,
and compile through a stylesheet ([ui-pictures.md](ui-pictures.md)).
