# Helper scripts

Python for the steps Node cannot do: Blender, images, Valve's DMX clips. Each script says how to
run it in its first lines. Blender scripts run with `blender -b <file.blend> --python <script> --
<args>`; the others with Python 3.11+ and numpy (Pillow for images).

| Script | Runs in | Does | Read |
|---|---|---|---|
| `export_fbx.py` | Blender | one skinned part and its armature to FBX in Source units, bone axes Y then X | [custom-models.md](../references/custom-models.md) |
| `make_vmdl.py` | Python | a vmdl for your FBX from the slot's decompiled vmdl, or with the hero's whole skeleton (`--skeleton-from`) | [custom-models.md](../references/custom-models.md) |
| `uv_cut.py` | Blender, then Python | hide part of the body: its UV triangles out of the model, then cut from the translucency map | [recolor.md](../references/recolor.md) |
| `dmx.py` | Python | Valve's binary DMX read and written byte for byte | [animations.md](../references/animations.md) |
| `clip.py` | Python | a clip's bone tracks out of and into a DMX; Valve's bind pose | [animations.md](../references/animations.md) |
| `pose.py` | Blender | a Blender action as the local bone transforms a clip holds | [animations.md](../references/animations.md) |
| `rig.py` | Python | skeleton, forward kinematics, blending, rotation helpers for clips written in code | [animations.md](../references/animations.md) |
| `prepare_vmdl.py` | Python | the hero's decompiled vmdl ready to compile with your clips (modifiers, bind pose, bone order, sounds) | [animations.md](../references/animations.md) |

All of them were used on the Necrophos "Scream" set and checked again for this skill: the clip
round trip through Blender reproduces Valve's idle to 0.0001 inch, and `prepare_vmdl.py`
reproduces the vmdl the set was compiled from.
