# A vmdl for your mesh, from the decompiled vmdl of the slot it replaces.
#   python make_vmdl.py <slot.vmdl> <out.vmdl> <mesh.fbx> <material.vmat> [<material.vmat> ...]
#       keeps the slot's skeleton, attachments, hitboxes and the rest; swaps meshes and materials
#   python make_vmdl.py --skeleton-from <hero.vmdl> <out.vmdl> <mesh.fbx> <material.vmat> [...]
#       a minimal vmdl: your mesh with the hero's whole skeleton, attachments and hitbox sets
#       (for a part that moves with bones its slot's own model does not have, such as a cloak)
# Paths inside the vmdl are relative to the addon's content folder: models/heroes/<hero>/mask.fbx,
# materials/models/heroes/<hero>/mymod/mask.vmat. Each vmat maps the FBX material of the same
# base name (mask.vmat <- material "mask").
import sys

HEADER = '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc28:version{fb63b6ca-f435-4aa0-a2c7-c66ddc651dca} -->\n'


def block(s, cls):
    """The whole child node of the root that has this _class, with its tabs and trailing comma."""
    i = s.index('_class = "%s"' % cls)
    a = s.rindex('\n\t\t\t{\n', 0, i) + 1
    b = s.index('\n\t\t\t},\n', i) + len('\n\t\t\t},\n')
    return s[a:b]


def meshes_and_materials(fbx, mats):
    remaps = "".join('\t\t\t\t\t\t\t{\n\t\t\t\t\t\t\t\tfrom = "%s"\n\t\t\t\t\t\t\t\tto = "%s"\n\t\t\t\t\t\t\t},\n'
                     % (m.rsplit("/", 1)[-1], m) for m in mats)
    return ('\t\t\t{\n\t\t\t\t_class = "RenderMeshList"\n\t\t\t\tchildren = \n\t\t\t\t[\n'
            '\t\t\t\t\t{\n\t\t\t\t\t\t_class = "RenderMeshFile"\n\t\t\t\t\t\tname = "mesh"\n'
            '\t\t\t\t\t\tfilename = "%s"\n\t\t\t\t\t\timport_scale = 0.01\n\t\t\t\t\t},\n\t\t\t\t]\n\t\t\t},\n'
            '\t\t\t{\n\t\t\t\t_class = "MaterialGroupList"\n\t\t\t\tchildren = \n\t\t\t\t[\n'
            '\t\t\t\t\t{\n\t\t\t\t\t\t_class = "DefaultMaterialGroup"\n\t\t\t\t\t\tremaps = \n\t\t\t\t\t\t[\n%s'
            '\t\t\t\t\t\t]\n\t\t\t\t\t\tuse_global_default = false\n\t\t\t\t\t\tglobal_default_material = ""\n'
            '\t\t\t\t\t},\n\t\t\t\t]\n\t\t\t},\n') % (fbx, remaps)


def from_slot(src, dst, fbx, mats):
    s = open(src, encoding="utf-8").read()
    at = s.index(block(s, "RenderMeshList"))
    # the slot's meshes, materials and LODs all go; ours take the meshes' place
    for cls in ("RenderMeshList", "MaterialGroupList", "LODGroupList"):
        if '_class = "%s"' % cls not in s: continue
        b = block(s, cls); i = s.index(b)
        s = s[:i] + s[i + len(b):]
        if i < at: at -= len(b)
    open(dst, "w", newline="\n", encoding="utf-8").write(s[:at] + meshes_and_materials(fbx, mats) + s[at:])


def with_skeleton(src, dst, fbx, mats):
    s = open(src, encoding="utf-8").read()
    keep = "".join(block(s, c) for c in ("AttachmentList", "HitboxSetList") if '_class = "%s"' % c in s)
    out = (HEADER + '{\n\trootNode = \n\t{\n\t\t_class = "RootNode"\n\t\tchildren = \n\t\t[\n'
           + meshes_and_materials(fbx, mats) + keep + block(s, "Skeleton") + '\t\t]\n\t}\n}\n')
    open(dst, "w", newline="\n", encoding="utf-8").write(out)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 4: sys.exit(__doc__ or "usage: make_vmdl.py [--skeleton-from] <src.vmdl> <out.vmdl> <mesh.fbx> <material.vmat>...")
    if a[0] == "--skeleton-from": a = a[1:]; with_skeleton(a[0], a[1], a[2], a[3:])
    else: from_slot(a[0], a[1], a[2], a[3:])
    print("written", a[1])
