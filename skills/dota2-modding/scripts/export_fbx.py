# One skinned part (mask, hood, cloak, weapon) and its armature to FBX in Source units, ready for a vmdl.
#   blender -b <set.blend> --python export_fbx.py -- <out.fbx> <object> [from_bone=to_bone ...]
# from=to renames a vertex group: the part moves onto another bone at export (the Scream mask went
# onto scarf_0_R, a bone no default item used, which the clips could then move on their own).
# The .blend must hold the hero's armature as Source2Viewer exported it (Valve's bind pose is its rest).
import bpy, sys
from mathutils import Matrix

args = sys.argv[sys.argv.index("--") + 1:]
out, name, renames = args[0], args[1], args[2:]
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
obj = bpy.data.objects[name]
for o in list(bpy.data.objects):
    if o not in (arm, obj): bpy.data.objects.remove(o)
for pair in renames:
    a, b = pair.split("=")
    obj.vertex_groups[a].name = b
# Each material leaves as a bare name, which the vmdl maps to a .vmat. With an image inside, the
# compiler looks for a vmat by the texture's path and fails with "could not be made content-relative".
for m in obj.data.materials:
    if m and m.node_tree: m.node_tree.nodes.clear()
    if m: m.use_nodes = False
for im in list(bpy.data.images): bpy.data.images.remove(im)
# metres to inches; the vmdl reads the file with import_scale = 0.01
arm.matrix_world = Matrix.Scale(1 / 0.0254, 4) @ arm.matrix_world
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# Bone axes Y then X (Blender's own) give the compiler Valve's bone frames exactly: 0.0 degrees on
# all 102 Necrophos bones. X then Y turned every bone 180 degrees.
bpy.ops.export_scene.fbx(filepath=out, use_selection=True, add_leaf_bones=False, object_types={'ARMATURE', 'MESH'},
    apply_unit_scale=False, global_scale=1.0, axis_forward='Y', axis_up='Z', bake_anim=False, mesh_smooth_type='FACE',
    use_armature_deform_only=False, primary_bone_axis='Y', secondary_bone_axis='X')
unweighted = sum(1 for v in obj.data.vertices if not any(g.weight > 0 for g in v.groups))
print(f"EXPORTED {name}: {len(obj.data.vertices)} vertices, materials {[m.name for m in obj.data.materials if m]}"
      + (f", {unweighted} vertices with no weight (they will stay at the origin's bone)" if unweighted else ""))
