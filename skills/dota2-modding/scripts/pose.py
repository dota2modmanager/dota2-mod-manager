# Blender side of new clips: an action on the hero's armature to the local bone transforms a clip's
# DMX holds (position in inches, orientation x y z w), for clip.py write.
#   blender -b <hero.blend> --python pose.py -- export <action> <bind.json> <frames.json> [fps]
# The .blend holds the hero's armature from Source2Viewer's glTF export, whose rest pose is Valve's
# bind pose; bind.json comes from `python clip.py bind <any clip of the hero>.dmx`. A Blender bone's
# frame differs from Valve's joint frame by a constant, found at rest, so poses cross over as world
# matrices and come out right whatever the bone axes.
import bpy, json, sys
from mathutils import Matrix, Quaternion, Vector

S = 1 / 0.0254
# Blender world -> game world: game = (-y, x, z) * S
CV = Matrix(((0, -S, 0, 0), (S, 0, 0, 0), (0, 0, S, 0), (0, 0, 0, 1)))
CV_INV = CV.inverted()


def armature():
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    arm.data.pose_position = 'POSE'    # a file saved showing the rest pose would export only that
    return arm


def world_from_locals(arm, local):
    """Game world matrices from local (pos, quat xyzw) per bone, parents first."""
    W = {}
    for b in arm.data.bones:
        p, q = local[b.name]
        m = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4(); m.translation = Vector(p)
        W[b.name] = (W[b.parent.name] @ m) if b.parent else m
    return W


def game_frames(arm, joints):
    """Per bone, the constant K with  Blender rest = CV^-1 @ game bind @ K."""
    return {b.name: joints[b.name].inverted() @ CV @ arm.matrix_world @ b.matrix_local for b in arm.data.bones}


def locals_from_world(arm, W):
    out = {}
    for b in arm.data.bones:
        m = (W[b.parent.name].inverted() @ W[b.name]) if b.parent else W[b.name]
        q = m.to_quaternion(); t = m.translation
        out[b.name] = ([t.x, t.y, t.z], [q.x, q.y, q.z, q.w])
    return out


def pose_world(arm, K):
    """The current pose as game world matrices."""
    return {pb.name: CV @ arm.matrix_world @ pb.matrix @ K[pb.name].inverted() for pb in arm.pose.bones}


def set_pose_world(arm, K, W):
    """Pose the armature so its bones are at these game world matrices (parents first): the other
    way, to look at one of Valve's clips (clip.frames_of) on your model in Blender."""
    inv = arm.matrix_world.inverted()
    for b in arm.data.bones:
        arm.pose.bones[b.name].matrix = inv @ CV_INV @ W[b.name] @ K[b.name]
        bpy.context.view_layer.update()


if __name__ == "__main__" and "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:]
    if args[0] != "export": sys.exit("usage: pose.py -- export <action> <bind.json> <frames.json> [fps]")
    arm = armature()
    bind = json.load(open(args[2]))
    missing = [b.name for b in arm.data.bones if b.name not in bind]
    if missing: sys.exit(f"bones the bind pose has not got: {missing[:10]}: is this the hero's own armature?")
    K = game_frames(arm, world_from_locals(arm, bind))
    act = bpy.data.actions[args[1]]
    arm.animation_data_create(); arm.animation_data.action = act
    # Blender keys at the scene's rate; the clip is sampled by time at its own (Dota's are 30)
    sc = bpy.context.scene
    rate = sc.render.fps / sc.render.fps_base
    fps = float(args[4]) if len(args) > 4 else 30.0
    f0, f1 = act.frame_range
    frames = []
    for i in range(round((f1 - f0) / rate * fps) + 1):
        at = f0 + i * rate / fps
        sc.frame_set(int(at), subframe=at - int(at))
        frames.append(locals_from_world(arm, pose_world(arm, K)))
    json.dump({"fps": fps, "frames": frames}, open(args[3], "w"))
    print("EXPORTED", args[1], len(frames), "frames at", fps)
