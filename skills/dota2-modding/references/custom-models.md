# Custom models: from Blender to the game

The route for new geometry (a mask, a hood, a cloak, a weapon): decompile the hero, build in
Blender on the hero's own skeleton, export FBX, write a `.vmdl` from Valve's, compile, pack. The
Scream set for Necrophos went through every step below; the numbers in it are Necrophos', so
measure your hero the same way.

## 1. Get the hero into Blender

```
Source2Viewer-CLI -i PAK -f models/heroes/<hero>/ -o work/decomp -d
Source2Viewer-CLI -i PAK -f materials/models/heroes/<hero>/ -o work/decomp -d
Source2Viewer-CLI -i PAK -f models/heroes/<hero>/<hero>.vmdl_c -o work/<hero>.glb -d \
  --gltf_export_format glb --gltf_export_materials --gltf_export_animations
```

Import the glb in Blender (File > Import > glTF, or `bpy.ops.import_scene.gltf`). The hero comes
with its armature in Valve's bind pose. Units are metres (Source units x 0.0254), the hero faces
-Y. Import the slot models you will replace the same way, to see where they sit.

`work/decomp` now holds Valve's `.vmdl` for the hero and each slot, the clips as `.dmx`, every
`.vmat` and the textures as PNG. Your models start from these files.

## 2. Pick the slot

A new part goes into the slot whose stock model it replaces; its vmdl keeps that slot's skeleton,
attachments and hitboxes. In the Scream set:

| Part | Slot | Skeleton |
|---|---|---|
| mask | beard (`beard.vmdl`) | the hero's, mask on a free bone |
| hood and Valve's own head under it | hat | the hero's |
| cloak, sleeves, belt, knife, the picker's telephone | shoulders | the whole hero's |
| scythe | weapon (`<hero>_sickle.vmdl`) | the weapon's two bones |

A slot you do not use keeps its stock model. Hide one with its material ([recolor.md](recolor.md)).

## 3. Build on the skeleton, never move the bones

- Rigid parts (a mask, a weapon) are weighted 100% to one bone. Do not touch the armature: every
  clip in the game moves the same bones, so your part follows every animation for free.
- Cloth and skin get weights from the body: Data Transfer from the body mesh (nearest face
  interpolated), limit 4 weights per vertex, normalise. Check which bones they took: the Scream
  cloak first got 5000 weights on the arm bones, and the arms dragged the cloak around. Move arm
  weights up the chain (bicep to 0.5 clavicle + 0.5 spine, forearm and hand to the spine).
- A part that must move on its own (a mask that falls off at death, a prop the hero picks up)
  goes on a bone no mesh and no cloth uses. Necrophos has `scarf_0_L/R` and `scarf_end_L/R`. Look
  for unused bones in the decompiled vmdl (bones no default item weights). Do not use bones the
  game simulates as cloth (beard bones): the simulation ignores their animation.
- Budget: the Scream cloak with props was about 18k triangles after decimating the props. Decimate
  downloaded models, and keep textures at 1024 px or less.

### Cloth over the body

A cloak modelled as a surface around a vertical axis, then pushed out: for each vertex, cast a ray
from the axis outward, find the farthest hit on the body, legs and anything under the cloak
(`BVHTree.ray_cast` repeatedly from the last hit), and move the vertex to that distance plus an
offset (0.12 m on Necrophos). Smooth after. Shrinkwrap with `OUTSIDE_SURFACE` crumples such a cloak.
A belt follows the hips' outline built from the body without the arm vertices, or it wraps the
hands in the bind pose.

A long cape over spread arms in the bind pose crumples when the arms come down. Keep capes over
the shoulders short, or give their front edges spine weights.

### A head inside a hood, a mask on the face

Built as layers: an egg-shaped liner around the skull, closed below; the mask laid on the front of
the egg; the hood in rings around it with an opening cut along the mask's outline. Weights: head
bones on top, the neck bone at the neck, the upper spine below; the hood's skirt joined to the
cloak by averaging the weights of the eight nearest cloak vertices.

**Hide what you cover.** Cut the body's head out with its translucency map
(`scripts/uv_cut.py`). Then fill what the game shows through the gaps: the game draws no back
faces, so when the hero throws its head back you look through the open hood. The Scream fix was
Valve's own head, copied from the body:

1. Copy the body, clear shape keys, keep only the armature modifier.
2. Weld vertices split along UV seams (`remove_doubles` at 1e-4), or smoothing opens cracks.
3. Keep the faces under the cut; subdivide once (Catmull-Clark).
4. Put the boundary at the neck back on the body's seam and pin it with a two-ring band. Pin
   **only** the neck's seam. A pinned open mouth kept the lips where Valve had them, and they
   stuck out through the mask's mouth.
5. Press in everything that comes out through the mask or the hood: rays from a point inside the
   skull to each vertex; a vertex beyond a wall moves to the wall minus a margin (0.02 m mask,
   0.03 m hood); spread each push to the neighbours and relax, until nothing is out.
6. Close the open mouth loops with faces.
7. Give it the body's material without the cut (`F_ALPHA_TEST 0`) and join it into the hood.

### Check for holes and clipping on every clip

Posing the model on a dozen clips (idle, run, attack, each cast, death, spawn, the picker) and
testing by rays catches what renders miss:

- **clipping:** a vertex of an inner layer that the outer layer covered at rest, where in the pose
  the ray forward finds nothing and the ray back hits the outer layer;
- **holes:** a ray from the hidden head outward that hits nothing (ignore rays looking down).

The Scream set ended at 0 holes and at most 3-7 clipping vertices in the worst frame of 16 clips.

## 4. Export FBX

`scripts/export_fbx.py` writes one object with its armature:

```
blender -b work/set.blend --python scripts/export_fbx.py -- work/content/models/heroes/<hero>/mask.fbx mask_obj [Head_1=scarf_0_R]
```

What it does and why:

- Scales to Source units (1/0.0254) and applies transforms; the vmdl reads it with
  `import_scale = 0.01`.
- `primary_bone_axis='Y', secondary_bone_axis='X'` (Blender's default). With these the compiler
  gets Valve's bone frames exactly: measured 0.0 degrees and 0.000 offset on all 102 Necrophos
  bones. The pair X,Y turned every bone 180 degrees, and every part needed per-bone corrections
  that broke where weights mixed bones (the hood slid up to 1.5 units).
- Strips material nodes and images, so each material is just a name. The vmdl maps that name to a
  `.vmat`; with an image inside, the compiler looks for a vmat by the texture's path and fails
  with "could not be made content-relative".
- `from=to` renames a vertex group, to move a part onto another bone at export.

## 5. Write the vmdl

Take the slot's decompiled vmdl and replace its meshes and materials, keeping the skeleton,
attachments and hitboxes:

```
python scripts/make_vmdl.py work/decomp/models/heroes/<hero>/beard.vmdl \
  "<install>/content/dota_addons/<addon>/models/heroes/<hero>/beard.vmdl" \
  models/heroes/<hero>/mask.fbx materials/models/heroes/<hero>/mymod/mask.vmat
```

Several materials in one FBX: list several vmats; each maps the material of the same base name.
A new part with the whole hero's skeleton but none of the hero's hitboxes (a cloak in the
shoulders slot): `scripts/make_vmdl.py --skeleton-from <hero>.vmdl`.

## 6. Materials

Write a `.vmat` per material with `hero.vfx` ([recolor.md](recolor.md) lists the keys). Starting
values that read well next to Valve's art:

```
"Layer0"
{
	"shader"	"hero.vfx"
	"F_USE_STATUS_EFFECTS_PROXY"	"1"
	"g_flSpecularExponent"	"10"
	"g_flSpecularScale"	"0.5"
	"g_flRimLightScale"	"0.5"
	"g_vRimLightColor"	"[1.000000 1.000000 1.000000 0.000000]"
	"TextureColor"	"materials/models/heroes/<hero>/mymod/mask_color.png"
	"TextureFresnelWarpRim"	"materials/default/default_fresnelwarprim.tga"
}
```

`F_USE_STATUS_EFFECTS_PROXY` lets status effects (Ghost Shroud, stuns, Diffusal) tint your part
like the hero. Cloth: specular 4 / 0.2, rim 0.3. A glowing blade: `F_MASKS_1` with a
`TextureSelfIllumMask`, `g_flSelfIllumScale` 1.6, bloom colour and scale 2.5.

## 7. Compile and pack

```
npm run modkit -- compile <addon>
npm run modkit -- pack "<install>/game/dota_addons/<addon>" --out work/<mod>.vpk
npm run doctor -- work/<mod>.vpk
```

Then render it the way the game draws it before the game ([testing.md](testing.md)).

## Props from outside the game

Models from Sketchfab and similar: check the licence first ([sharing.md](sharing.md)). Decimate
to a few thousand triangles, bake textures to 1024 px, rig to a free bone, and give each part its
own material name (one material for a phone and its cord made the cord shine like the bakelite).
