# The hero's skeleton in numpy: Valve's bind pose and parents (from a clip's DMX joints), world
# matrices of a frame by forward kinematics, and back to the local (position, x y z w) a clip holds.
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import dmx

def skeleton(path):
    """[(name, parent or None)] parents first, and the bind pose {name: (pos, quat)}."""
    d = dmx.read(path); E = d["elements"]
    model = next(e for e in E if e["type"] == "DmeModel")
    order = []
    def walk(i, parent):
        e = E[i]
        if e["type"] != "DmeJoint": return
        order.append((e["name"], parent))
        for c in e["attrs"]["children"][1]: walk(c, e["name"])
    for c in model["attrs"]["children"][1]: walk(c, None)
    bind = {}
    for e in E:
        if e["type"] == "DmeJoint":
            tr = E[e["attrs"]["transform"][1]]["attrs"]
            bind[e["name"]] = (list(tr["position"][1]), list(tr["orientation"][1]))
    return order, bind

def q2m(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def m2q(m):
    t = np.trace(m)
    if t > 0:
        s = 0.5 / np.sqrt(t + 1); w = 0.25 / s
        x = (m[2, 1] - m[1, 2]) * s; y = (m[0, 2] - m[2, 0]) * s; z = (m[1, 0] - m[0, 1]) * s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = 2 * np.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2])
        w = (m[2, 1] - m[1, 2]) / s; x = 0.25 * s; y = (m[0, 1] + m[1, 0]) / s; z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = 2 * np.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2])
        w = (m[0, 2] - m[2, 0]) / s; x = (m[0, 1] + m[1, 0]) / s; y = 0.25 * s; z = (m[1, 2] + m[2, 1]) / s
    else:
        s = 2 * np.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1])
        w = (m[1, 0] - m[0, 1]) / s; x = (m[0, 2] + m[2, 0]) / s; y = (m[1, 2] + m[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)

def mat(pos, quat):
    m = np.eye(4); m[:3, :3] = q2m(quat); m[:3, 3] = pos; return m

def local(m):
    return [float(x) for x in m[:3, 3]], [float(x) for x in m2q(m[:3, :3])]

def fk(order, frame):
    """World matrices of one frame {name: (pos, quat)}."""
    W = {}
    for name, parent in order:
        m = mat(*frame[name])
        W[name] = W[parent] @ m if parent else m
    return W

def locals_of(order, W):
    return {name: local(np.linalg.inv(W[parent]) @ W[name] if parent else W[name]) for name, parent in order}

def rigid(m):
    """The nearest rotation to a 3x3 (a blend of rotations is not one)."""
    u, _, vt = np.linalg.svd(m)
    r = u @ vt
    if np.linalg.det(r) < 0: u[:, -1] *= -1; r = u @ vt
    return r

def rot_between(a, b):
    """The smallest rotation taking direction a to direction b."""
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(np.dot(a, b))
    if c < -0.999999:
        axis = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        axis /= np.linalg.norm(axis); return 2 * np.outer(axis, axis) - np.eye(3)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k / (1 + c)

def slerp(q0, q1, t):
    q0 = np.asarray(q0, float); q1 = np.asarray(q1, float)
    d = float(np.dot(q0, q1))
    if d < 0: q1 = -q1; d = -d
    if d > 0.9995: q = q0 + t * (q1 - q0); return q / np.linalg.norm(q)
    th = np.arccos(d); return (np.sin((1 - t) * th) * q0 + np.sin(t * th) * q1) / np.sin(th)

def blend(m0, m1, t):
    """Rigid transforms in between: rotation by slerp, translation linear."""
    q = slerp(m2q(m0[:3, :3]), m2q(m1[:3, :3]), t)
    out = np.eye(4); out[:3, :3] = q2m(q); out[:3, 3] = (1 - t) * m0[:3, 3] + t * m1[:3, 3]; return out
