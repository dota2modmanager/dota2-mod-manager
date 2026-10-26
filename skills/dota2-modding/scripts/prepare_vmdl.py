# The hero's decompiled vmdl, made ready to compile again with your clips in place of Valve's.
#   python prepare_vmdl.py <config.json>
# config.json:
#   {
#     "vmdl":   "work/decomp/models/heroes/necrolyte/necrolyte.vmdl",   Source2Viewer's decompile
#     "model":  "work/model.json",          from: npm run modkit -- model <hero> --out work/model.json
#     "addon":  "<...>/dota 2 beta/content/dota_addons/my_clips",       where to write
#     "clips":  {"idle_anim": "work/clips/idle_anim.dmx"},               Valve's clip name -> your DMX
#     "sounds": {"loadout_spawn": [[24, "Hero_Necrolyte.Scream.ring"]]}, optional, see below
#     "move_last": ["sickle1"]                                           optional, see below
#   }
# Then: npm run modkit -- compile my_clips, and npm run modkit -- clips on the compiled model.
#
# What the decompile gets wrong, and what this puts right:
# - Activity modifiers are missing. Without them an item's clip (immosh, ti7, injured...) loses its
#   tag and plays at random in place of the plain one. They come back from model.json.
# - Sibling bones can come in another order, and the compiler numbers bones by its own rules. A
#   clip's tracks go by bone number: with Necrophos' sickle1 first among wrist_R's children the right
#   hand's fingers got the sickle's track. `modkit clips` compares the compiled order of animated bones with
#   Valve's and names the first bone out of place; list it in "move_last" (it goes last among its
#   siblings) and compile again. Necrophos needs ["sickle1"].
# - bindPose goes first in the AnimationList, where Valve's compile has it; elsewhere every
#   sequence after it moved a number.
# "sounds" replaces a sequence's voice line (AE_CL_SPEECH) with your sound events at given frames,
# for a menu clip whose own voice line would talk over yours. The events must exist in a sound
# event file the game loads (references/sounds.md).
import json, os, re, shutil, sys


def block_end(s, start):
    """Index just past the brace or bracket that closes the one opening at start."""
    depth = 0; i = start; q = False
    while i < len(s):
        c = s[i]
        if c == '"': q = not q
        elif not q and c in "{[": depth += 1
        elif not q and c in "}]":
            depth -= 1
            if depth == 0: return i + 1
        i += 1
    raise ValueError("unclosed block")


def with_modifiers(text, modifiers):
    out = []; at = 0; fixed = 0
    for m in re.finditer(r'\{\s*\n(\t+)_class = "AnimFile"', text):
        start = m.start(); ind = m.group(1)
        end = block_end(text, start)
        body = text[start:end]
        name = re.search(r'\n' + ind + r'name = "([^"]+)"', body).group(1)
        have = set(re.findall(r'activity_name = "([^"]+)"', body))
        extra = [n for n in modifiers.get(name, []) if n not in have]
        if extra:
            nodes = "".join('%s{\n%s\t_class = "ActivityModifier"\n%s\tactivity_name = "%s"\n%s\tactivity_weight = 1\n%s},\n'
                            % (ind + "\t", ind + "\t", ind + "\t", n, ind + "\t", ind + "\t") for n in extra)
            child = re.search(r'\n' + ind + r'children = \s*\n' + ind + r'\[\n', body)
            if child: body = body[:child.end()] + nodes + body[child.end():]
            else: body = body[:-1].rstrip("\t") + ind + "children = \n" + ind + "[\n" + nodes + ind + "]\n" + ind[:-1] + "}"
            fixed += 1
        out.append(text[at:start]); out.append(body); at = end
    return "".join(out) + text[at:], fixed


def moved_last(text, bone):
    """The skeleton with this bone (and its children) last among its siblings."""
    sk = text.index('_class = "Skeleton"')
    at = text.index('name = "%s"' % bone, sk)
    start = text.rindex("{", 0, at); start = text.rindex("\n", 0, start) + 1
    end = block_end(text, text.index("{", start)) + 2   # through the comma and the line end
    node = text[start:end]
    # the parent's children list: the bracket that opens before the bone and is still open there
    depth = 0; i = start
    while True:
        i -= 1
        if text[i] in "]}": depth += 1
        elif text[i] in "[{":
            if depth == 0 and text[i] == "[": break
            depth -= 1
    close = block_end(text, i) - 1
    close = text.rindex("\n", 0, close) + 1
    return text[:start] + text[end:close] + node + text[close:]


def playsound(ind, frame, name):
    return ('%s{\n%s\t_class = "AnimEvent"\n%s\tevent_class = "AE_CL_PLAYSOUND"\n%s\tevent_frame = %d\n%s\tevent_keys = \n%s\t{\n'
            '%s\t\tname = "%s"\n%s\t\tstop_on_seq_change = false\n%s\t\tuse_layer_sequence = false\n%s\t\ttags = null\n%s\t}\n%s},\n') % (
            ind, ind, ind, ind, frame, ind, ind, ind, name, ind, ind, ind, ind, ind)


def with_sounds(text, sounds):
    for seq, events in sounds.items():
        at = re.search(r'\n\t+name = "%s"\n' % re.escape(seq), text)
        if not at: sys.exit(f"sounds: no clip named {seq}")
        speech = re.compile(r'\n(\t+)\{\n\t+_class = "AnimEvent"\n\t+event_class = "AE_CL_SPEECH"\n').search(text, at.start())
        nxt = text.find('_class = "AnimFile"', at.end())
        if not speech or (nxt >= 0 and speech.start() > nxt): sys.exit(f"sounds: {seq} has no voice line to replace")
        ind = speech.group(1)
        end = block_end(text, text.index("{", speech.start())) + 2
        text = text[:speech.start() + 1] + "".join(playsound(ind, f, n) for f, n in events) + text[end:]
    return text


def main(cfg):
    base = os.path.dirname(os.path.abspath(cfg))
    c = json.load(open(cfg))
    p = lambda x: x if os.path.isabs(x) else os.path.join(base, x)
    src = p(c["vmdl"]); hero = os.path.basename(src)[:-5]
    model = json.load(open(p(c["model"])))
    text = open(src, encoding="utf-8").read()

    modifiers = {s["name"]: s["modifiers"] for s in model["sequences"] if s["modifiers"]}
    text, fixed = with_modifiers(text, modifiers)

    for bone in c.get("move_last", []): text = moved_last(text, bone)
    named = re.findall(r'_class = "Bone"\n\t+name = "([^"]+)"', text)

    bind = re.search(r'\n(\t+)\{\n\t+_class = "AnimBindPose"\n\t+name = "bindPose"\n\t+\},', text)
    if bind:
        text = text[:bind.start()] + text[bind.end():]
        head = re.search(r'_class = "AnimationList"\n\t+children = \s*\n\t+\[', text)
        text = text[:head.end()] + bind.group(0) + text[head.end():]

    folder = f"models/heroes/{hero}/"
    for name, dmx in c.get("clips", {}).items():
        text, n = re.subn(r'(\n\t+name = "%s"\n\t+source_filename = ")[^"]+"' % re.escape(name),
                          r'\g<1>' + folder + os.path.basename(dmx) + '"', text)
        if n != 1: sys.exit(f"clips: {name} is not a clip of the vmdl (found {n})")
    text = with_sounds(text, c.get("sounds", {}))

    dst = os.path.join(p(c["addon"]), folder)
    os.makedirs(dst, exist_ok=True)
    srcdir = os.path.dirname(src)
    for f in os.listdir(srcdir):
        if f.startswith(hero + "_") and f.endswith(".dmx"): shutil.copy(os.path.join(srcdir, f), dst + f)
    for dmx in c.get("clips", {}).values(): shutil.copy(p(dmx), dst + os.path.basename(dmx))
    open(dst + hero + ".vmdl", "w", encoding="utf-8", newline="\n").write(text)
    print(f"{dst}{hero}.vmdl: modifiers back on {fixed} clips, {len(named)} bones, "
          f"{len(c.get('clips', {}))} clips of yours, {len(c.get('sounds', {}))} voice lines replaced")


if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: prepare_vmdl.py <config.json> (see the top of this file)")
    main(sys.argv[1])
