# Cloth on an item: chains of the item's own bones the game simulates, swinging with the hero's
# moves and pulled back to where the clips put them. For a soft hat's tip, a braid, a tassel, a
# hanging belly; it holds up better than jiggle bones, which flicked a whole part on idle head turns.
#
#   python cloth.py <part.vmdl> <ref.vmdl> <chain> [<chain> ...] [off]
#     <part.vmdl>  a vmdl written by make_vmdl.py; edited in place
#     <ref.vmdl>   a ModelDoc source of Valve's with a ClothChain in it, for the joints' attribute
#                  schema: content/dota/particles/models/heroes/tidehunter/tidehunter_chain_model.vmdl
#                  ships with the Workshop Tools
#     <chain>      <stray radius>:<goal strength at the top>:<goal strength at the tip>:<bone>,<bone>,...
#                  the first bone is pinned (it follows the animation), the rest are simulated
#     off          write the vmdl without the cloth: the A/B build that tells whether a tilt in the
#                  game is the simulation or the model
#
# Written the way Valve builds a hanging chain: one Softbody node under the root holding a ClothChain
# per chain. What the numbers do:
#   stray radius   how far in inches a node may wander from where the clip puts it. The cloth does not
#                  collide with the body, so this is all that keeps a tip out of the head: 3-4 for a
#                  hat's tip; a large surface split into several chains crumpled at 3, as the chains
#                  have no links between them and drift apart in poses.
#   goal strength  the pull back to the animated pose, 0-1. 0.9 at the top easing to 0.65 at the tip
#                  kept a hat's shape and let it lean on turns; weaker reads as a rope.
# The bones must be in the FBX (export the part with its chain), so the Skeleton node make_vmdl.py
# copied from the hero (Valve's bones only) is dropped. Check the compile: the compiled model's PHYS
# block holds an m_pFeModel with one node per bone when the cloth took.
import sys


def close_of(text, j):
    """The index of the brace that closes the one at j."""
    depth = 0
    while True:
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return j
        j += 1


def main(argv):
    path, ref = argv[0], argv[1]
    off = argv[-1] == 'off'
    chains = []
    for a in argv[2:]:
        if a == 'off':
            continue
        rad, g0, g1, bones = a.split(':')
        chains.append((float(rad), float(g0), float(g1), bones.split(',')))
    if not chains:
        sys.exit('name at least one chain: <stray radius>:<goal top>:<goal tip>:<bone>,<bone>,...')
    s = open(path, encoding='utf-8').read()
    if '_class = "Skeleton"' in s:
        i = s.index('_class = "Skeleton"')
        a = s.rindex('\n', 0, s.rindex('{', 0, i)) + 1
        s = s[:a] + s[s.index('\n', close_of(s, s.index('{', a))) + 1:]
    r = open(ref, encoding='utf-8').read()
    ai = r.index('attrs = ')
    attrs = r[ai:close_of(r, r.index('{', ai)) + 1]

    T = '\t'
    nodes = []
    for rad, g0, g1, bones in chains:
        joints = []
        for n, bone in enumerate(bones):
            j = T * 8 + '{\n' + T * 9 + 'joint_name = "%s"\n' % bone
            if n:
                j += T * 9 + 'joint_parent = "%s"\n' % bones[n - 1]
            if n == 0:
                j += T * 9 + 'simulate = false\n'
            else:
                f = (n - 1) / max(1, len(bones) - 2)
                for k, v in (('goal_strength', g0 + (g1 - g0) * f), ('goal_damping', 0.4), ('drag', 0.15),
                             ('stretch_spring', 1.0), ('stray_radius', rad), ('stray_radius_stretchiness', 0.2)):
                    j += T * 9 + '%s = %s\n' % (k, round(v, 3))
            joints.append(j + T * 8 + '},\n')
        nodes.append(T * 5 + '{\n' + T * 6 + '_class = "ClothChain"\n' + T * 6 + 'root_bone = "%s"\n' % bones[0]
                     + T * 6 + 'chain = \n' + T * 6 + '{\n' + T * 7 + 'joints = \n' + T * 7 + '[\n' + ''.join(joints)
                     + T * 7 + ']\n' + T * 7 + attrs + '\n' + T * 7 + 'selection = [  ]\n' + T * 7 + 'version = 1\n'
                     + T * 6 + '}\n' + T * 5 + '},\n')
    node = (T * 3 + '{\n' + T * 4 + '_class = "Softbody"\n' + T * 4 + 'children = \n' + T * 4 + '[\n' + ''.join(nodes)
            + T * 4 + ']\n' + T * 4 + 'stiffness_on_ragdoll = 0.0\n' + T * 4 + 'cloth_sleep_enabled = false\n'
            + T * 4 + 'cloth_per_bone_scale_enabled = false\n' + T * 3 + '},\n')
    if not off:
        head = '\t\tchildren = \n\t\t[\n'
        i = s.index(head, s.index('_class = "RootNode"')) + len(head)
        s = s[:i] + node + s[i:]
    open(path, 'w', newline='\n', encoding='utf-8').write(s)
    print(('no cloth (A/B) ' if off else 'cloth ') + path, [len(c[3]) for c in chains], 'bones')


if __name__ == '__main__':
    main(sys.argv[1:])
