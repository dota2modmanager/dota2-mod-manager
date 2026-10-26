# Hide part of a hero's body: black out, in the body's translucency map, the texels of the
# triangles that belong to that part (its bones), and leave the texels other triangles share.
#
# Step 1, in Blender: which UV triangles belong to the part.
#   blender -b --python uv_cut.py -- tris <hero.glb or .blend> <tris.json> Head_0,Head_1 [--mesh NAME] [--min 0.5]
#   A triangle is the part's when every one of its vertices has more than --min of its weight on
#   the bones listed. The .glb is Source2Viewer's export of the hero's model.
# Step 2, in Python with Pillow and numpy: the new translucency map.
#   python uv_cut.py cut <tris.json> <valve_trans.png> <out_trans.png> [--grow 1]
#   Cuts every texel inside the part's triangles, plus a margin of --grow texels into empty space.
#   The margin never reaches into another triangle; the part's own texels go whatever the margin.
#   (Where two UV islands lie a few texels apart their margins cancel out, and with the margin
#   alone the Necrophos head left a dotted line across the throat in the game.)
# Then set F_ALPHA_TEST 1 in the body's vmat, point TextureTranslucency at the new map, compile.
import json, sys


def option(args, name, default):
    if name in args:
        i = args.index(name); value = args[i + 1]; del args[i:i + 2]; return value
    return default


def tris(args):
    import bpy
    mesh_name = option(args, "--mesh", None); low = float(option(args, "--min", "0.5"))
    src, out, bones = args[0], args[1], set(args[2].split(","))
    if src.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=src)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and (mesh_name is None or o.name == mesh_name)]
    if not meshes: sys.exit("no mesh" + (f" named {mesh_name}" if mesh_name else ""))
    body = max(meshes, key=lambda o: len(o.data.vertices))   # the body is the biggest mesh
    names = {g.index: g.name for g in body.vertex_groups}
    missing = bones - set(names.values())
    if missing: sys.exit(f"{body.name} has no bones {sorted(missing)}; it has {sorted(names.values())[:40]}")
    weight = [sum(g.weight for g in v.groups if names[g.group] in bones) for v in body.data.vertices]
    uv = body.data.uv_layers.active.data
    out_tris = {"part": [], "other": []}
    body.data.calc_loop_triangles()
    for t in body.data.loop_triangles:
        key = "part" if min(weight[i] for i in t.vertices) > low else "other"
        out_tris[key].append([list(uv[l].uv) for l in t.loops])
    json.dump(out_tris, open(out, "w"))
    print(f"{body.name}: {len(out_tris['part'])} triangles of the part, {len(out_tris['other'])} others -> {out}")


def cut(args):
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
    grow = int(option(args, "--grow", "1"))
    T = json.load(open(args[0]))
    src = Image.open(args[1]).convert("L"); S = src.size

    def rast(ts, g=0):
        im = Image.new("L", S, 0); d = ImageDraw.Draw(im)
        for t in ts: d.polygon([((u % 1) * S[0], (1 - (v % 1)) * S[1]) for u, v in t], fill=255)
        return im.filter(ImageFilter.MaxFilter(g)) if g else im

    size = grow * 2 + 1 if grow else 0     # MaxFilter takes an odd size
    part = np.asarray(rast(T["part"], size)) > 0
    other = np.asarray(rast(T["other"], size)) > 0
    own = np.asarray(rast(T["part"])) > 0
    gone = (part & ~other) | own
    Image.fromarray(np.where(gone, 0, np.asarray(src)).astype(np.uint8), "L").save(args[2])
    print(f"{S[0]}x{S[1]}: {int(gone.sum())} texels cut -> {args[2]}")


if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    {"tris": tris, "cut": cut}[a[0]](a[1:])
