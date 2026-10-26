# A clip's bone tracks out of its DMX (dmx.py) and back in: per bone, per frame, the local position
# (inches) and orientation (x y z w) the game plays. Face (flex) channels stay as they are.
#   python clip.py bind <any clip of the hero.dmx> <bind.json>
#       Valve's bind pose, which pose.py needs to carry poses between Blender and the game
#   python clip.py info <clip.dmx>
#       frames, rate and bones of a clip
#   python clip.py write <valve clip.dmx> <frames.json> <out.dmx>
#       Valve's clip with its bone tracks replaced by the frames pose.py exported from Blender; the
#       new clip may be longer or shorter, and bones missing from the frames keep Valve's tracks
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dmx

TICKS = 10000   # DMX time is in 1/10000 s


def _channels(d):
    E = d["elements"]
    clip = next(e for e in E if e["type"] == "DmeChannelsClip")
    for i in clip["attrs"]["channels"][1]:
        ch = E[i]
        to = E[ch["attrs"]["toElement"][1]]
        attr = ch["attrs"]["toAttribute"][1]
        if attr not in ("position", "orientation"): continue
        log = E[ch["attrs"]["log"][1]]
        layer = E[log["attrs"]["layers"][1][0]]
        yield to["name"], attr, layer


def clip_duration(d):
    E = d["elements"]
    clip = next(e for e in E if e["type"] == "DmeChannelsClip")
    return E[clip["attrs"]["timeFrame"][1]]["attrs"]["duration"][1]


def load(path):
    d = dmx.read(path)
    clip = next(e for e in d["elements"] if e["type"] == "DmeChannelsClip")
    fps = clip["attrs"]["frameRate"][1]
    tracks = {}
    for bone, attr, layer in _channels(d):
        tracks.setdefault(bone, {})[attr] = (layer["attrs"]["times"][1], layer["attrs"]["values"][1])
    frames = round(clip_duration(d) * fps / TICKS) + 1
    return d, fps, frames, tracks


def sample(track, t):
    """The value at time t (ticks): the key at or before it (clips are keyed every frame)."""
    times, values = track
    j = 0
    while j + 1 < len(times) and times[j + 1] <= t: j += 1
    return values[j]


def frames_of(path):
    """[{bone: (pos, quat)}] per frame, and fps."""
    d, fps, n, tracks = load(path)
    out = []
    for f in range(n):
        t = round(f * TICKS / fps)
        out.append({b: (list(sample(tr["position"], t)), list(sample(tr["orientation"], t))) for b, tr in tracks.items()})
    return out, fps


def save(path_in, path_out, frames, fps=None):
    """The clip at path_in with its bone tracks replaced by frames (every bone keyed every frame)."""
    d = dmx.read(path_in)
    E = d["elements"]
    clip = next(e for e in E if e["type"] == "DmeChannelsClip")
    fps = fps or clip["attrs"]["frameRate"][1]
    clip["attrs"]["frameRate"] = (dmx.T_FLOAT, float(fps))
    times = [round(f * TICKS / fps) for f in range(len(frames))]
    E[clip["attrs"]["timeFrame"][1]]["attrs"]["duration"] = (dmx.T_TIME, times[-1])
    for bone, attr, layer in _channels(d):
        if bone not in frames[0]:
            # a bone the frames leave out keeps Valve's track, sampled at the new times
            track = (layer["attrs"]["times"][1], layer["attrs"]["values"][1])
            layer["attrs"]["values"] = (layer["attrs"]["values"][0], [tuple(sample(track, t)) for t in times])
        else:
            k = 0 if attr == "position" else 1
            layer["attrs"]["values"] = (layer["attrs"]["values"][0], [tuple(fr[bone][k]) for fr in frames])
        layer["attrs"]["times"] = (dmx.T_TIME + dmx.ARRAY, list(times))
    dmx.write(d, path_out)


def bind(path):
    """Valve's bind pose: each joint's local transform in the clip's skeleton."""
    d = dmx.read(path)
    E = d["elements"]
    out = {}
    for e in E:
        if e["type"] != "DmeJoint": continue
        tr = E[e["attrs"]["transform"][1]]["attrs"]
        out[e["name"]] = (list(tr["position"][1]), list(tr["orientation"][1]))
    return out


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["bind"]:
        json.dump(bind(a[1]), open(a[2], "w"), indent=0); print("bind pose of", len(bind(a[1])), "bones ->", a[2])
    elif a[:1] == ["info"]:
        d, fps, n, tracks = load(a[1]); print(f"{n} frames at {fps} fps, {len(tracks)} bones: {', '.join(sorted(tracks))}")
    elif a[:1] == ["write"]:
        data = json.load(open(a[2]))
        save(a[1], a[3], data["frames"], data.get("fps"))
        print(f"{len(data['frames'])} frames at {data.get('fps')} fps -> {a[3]}")
    else:
        sys.exit("usage: clip.py bind|info|write ... (see the top of this file)")
