# Valve's binary DMX (encoding binary 9), read into elements and written back byte for byte, for the
# animation clips Source2Viewer decompiles (decomp/models/heroes/<hero>/<hero>_*.dmx). `python dmx.py <clip.dmx> [copy.dmx]`
# prints the element types and checks that a copy comes out byte for byte.
# An element is {"type", "name", "id" (16 bytes), "attrs": {name: (type, value)}}; an element
# attribute's value is the index of the element it points to (-1 none).
import struct

T_ELEMENT, T_INT, T_FLOAT, T_BOOL, T_STRING, T_BINARY, T_TIME, T_COLOR, T_V2, T_V3, T_V4, T_QANGLE, T_QUAT, T_MATRIX, T_U64, T_BYTE = range(1, 17)
ARRAY = 32
FMT = {T_INT: "<i", T_FLOAT: "<f", T_BOOL: "<?", T_TIME: "<i", T_COLOR: "<4B", T_V2: "<2f", T_V3: "<3f", T_V4: "<4f",
       T_QANGLE: "<3f", T_QUAT: "<4f", T_MATRIX: "<16f", T_U64: "<Q", T_BYTE: "<B"}

class Reader:
    def __init__(self, b): self.b = b; self.at = 0
    def take(self, f):
        v = struct.unpack_from(f, self.b, self.at); self.at += struct.calcsize(f); return v if len(v) > 1 else v[0]
    def cstr(self):
        e = self.b.index(b"\0", self.at); s = self.b[self.at:e].decode("utf-8"); self.at = e + 1; return s

def read(path):
    b = open(path, "rb").read()
    r = Reader(b)
    header = r.cstr()
    assert "binary 9" in header, header
    prefix = []
    for _ in range(r.take("<i")):
        attrs = []
        for _ in range(r.take("<i")):
            name = r.take("<i"); attrs.append((name, *value(r, r.take("<B"), None)))
        prefix.append(attrs)
    strings = [r.cstr() for _ in range(r.take("<i"))]
    elements = []
    for _ in range(r.take("<i")):
        t, nm = r.take("<i"), r.take("<i"); gid = bytes(b[r.at:r.at + 16]); r.at += 16
        elements.append({"type": strings[t], "name": strings[nm], "id": gid, "attrs": {}})
    for e in elements:
        for _ in range(r.take("<i")):
            name = strings[r.take("<i")]; t = r.take("<B")
            e["attrs"][name] = value(r, t, strings)
    assert r.at == len(b), (r.at, len(b))
    return {"header": header, "prefix": prefix, "strings": strings, "elements": elements}

def value(r, t, strings):
    if t >= ARRAY:
        base = t - ARRAY; return (t, [value(r, base, strings)[1] for _ in range(r.take("<i"))])
    if t == T_ELEMENT:
        i = r.take("<i")
        if i == -2: raise ValueError("external element")
        return (t, i)
    if t == T_STRING:
        return (t, strings[r.take("<i")] if strings is not None else r.cstr())
    if t == T_BINARY:
        n = r.take("<i"); v = bytes(r.b[r.at:r.at + n]); r.at += n; return (t, v)
    return (t, r.take(FMT[t]))

def write(dmx, path):
    strings = list(dmx.get("strings", [])); sid = {x: i for i, x in reversed(list(enumerate(strings)))}
    def s(x):
        if x not in sid: sid[x] = len(strings); strings.append(x)
        return sid[x]
    els = dmx["elements"]
    for e in els:
        s(e["type"]); s(e["name"])
    for e in els:
        for k, (t, v) in e["attrs"].items():
            s(k)
            if t == T_STRING: s(v)
            elif t == T_STRING + ARRAY: [s(x) for x in v]
    out = [dmx["header"].encode() + b"\0"]
    out.append(struct.pack("<i", len(dmx["prefix"])))
    for p in dmx["prefix"]:
        out.append(struct.pack("<i", len(p)))
        for name, t, v in p: out.append(struct.pack("<iB", name, t) + enc(t, v, None))
    out.append(struct.pack("<i", len(strings)))
    out += [x.encode() + b"\0" for x in strings]
    out.append(struct.pack("<i", len(els)))
    for e in els: out.append(struct.pack("<ii", sid[e["type"]], sid[e["name"]]) + e["id"])
    for e in els:
        out.append(struct.pack("<i", len(e["attrs"])))
        for k, (t, v) in e["attrs"].items(): out.append(struct.pack("<iB", sid[k], t) + enc(t, v, sid))
    open(path, "wb").write(b"".join(out))

def enc(t, v, sid):
    if t >= ARRAY: return struct.pack("<i", len(v)) + b"".join(enc(t - ARRAY, x, sid) for x in v)
    if t == T_ELEMENT: return struct.pack("<i", v)
    if t == T_STRING: return struct.pack("<i", sid[v]) if sid is not None else v.encode() + b"\0"
    if t == T_BINARY: return struct.pack("<i", len(v)) + v
    f = FMT[t]
    return struct.pack(f, *v) if isinstance(v, tuple) else struct.pack(f, v)

if __name__ == "__main__":
    import sys
    d = read(sys.argv[1])
    from collections import Counter
    print(Counter(e["type"] for e in d["elements"]).most_common(20))
    if len(sys.argv) > 2:
        write(d, sys.argv[2]); print("same bytes", open(sys.argv[1], "rb").read() == open(sys.argv[2], "rb").read())
