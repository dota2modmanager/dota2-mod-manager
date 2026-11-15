/* The map's meshes merged off the window's thread (map-merge.ts sends them). The geometries come
 * as they lie in the map's buffers (each buffer sent once, an attribute a place in one: its type,
 * where it starts, its stride, whether its integers stand for -1..1), since reading them into
 * floats on the window's thread first was most of the three seconds the window froze. Each job is
 * one merged mesh, its parts a geometry and the matrix that places it: positions take the matrix,
 * normals its rotation, the rest come as they are; a part whose matrix mirrors it has its
 * triangles turned round, as a mirrored object shows them.
 *
 * What comes in a message is not trusted to name things: a kind picks its array out of a table of
 * its own (a switch, each constructor named), attributes go into a Map and back as a list of pairs, never as an object's properties
 * by a name the message gave, and the triangles are written with set(). */

export type Kind = 'f32' | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32';
export interface View { buf: number; kind: Kind; offset: number; stride: number; size: number; normalized: boolean; count: number }
export interface Geo { attrs: Record<string, View>; index: { buf: number; kind: Kind; offset: number; length: number } | null; count: number }
export interface Part { geo: number; matrix: number[]; flip: boolean }
export interface Job { id: number; parts: Part[] }
export interface Merged { id: number; attrs: [string, { array: Float32Array; size: number }][]; index: Uint32Array; sphere: [number, number, number, number] }

/** A buffer read as the kind of numbers a view says, each constructor named here: none picked by the message's word. */
function typedView(kind: string, b: ArrayBuffer): ArrayLike<number> | null {
  switch (kind) {
    case 'f32': return new Float32Array(b, 0, b.byteLength >> 2);
    case 'i8': return new Int8Array(b);
    case 'u8': return new Uint8Array(b);
    case 'i16': return new Int16Array(b, 0, b.byteLength >> 1);
    case 'u16': return new Uint16Array(b, 0, b.byteLength >> 1);
    case 'i32': return new Int32Array(b, 0, b.byteLength >> 2);
    case 'u32': return new Uint32Array(b, 0, b.byteLength >> 2);
    default: return null;
  }
}
const SCALE: Record<Kind, number> = { f32: 1, i8: 127, u8: 255, i16: 32767, u16: 65535, i32: 1, u32: 1 };

export function kindOf(a: ArrayLike<number>): Kind {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Int8Array) return 'i8';
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int32Array) return 'i32';
  return 'u32';
}

/** The 3x3 normal matrix of a 4x4 (inverse transpose of its rotation part), column-major. */
function normalMatrix(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

export function merge(buffers: ArrayBuffer[], geos: Geo[], job: Job): Merged {
  const typed = new Map<string, ArrayLike<number>>();
  const arr = (buf: number, kind: Kind) => {
    const k = `${buf}|${kind}`;
    let a = typed.get(k);
    if (!a) {
      const b = buffers[buf];
      const v = b instanceof ArrayBuffer ? typedView(kind, b) : null;
      if (!v) throw new Error(`merge: no buffer ${buf} of ${kind}`);
      a = v;
      typed.set(k, a);
    }
    return a;
  };
  let verts = 0, idx = 0;
  for (const p of job.parts) { const g = geos[p.geo]; verts += g.count; idx += g.index ? g.index.length : g.count; }
  const first = geos[job.parts[0].geo];
  const attrs = new Map<string, { array: Float32Array; size: number }>();
  for (const [name, a] of Object.entries(first.attrs)) attrs.set(name, { array: new Float32Array(verts * a.size), size: a.size });
  const index = new Uint32Array(idx);
  let vAt = 0, iAt = 0;
  for (const p of job.parts) {
    const g = geos[p.geo], m = p.matrix;
    for (const [name, out] of attrs) {
      const v = g.attrs[name];
      if (!v) continue;
      const src = arr(v.buf, v.kind), o = out.array, s = v.size, base = vAt * s;
      const scale = v.normalized ? 1 / SCALE[v.kind] : 1;
      const at = (i: number, c: number) => {
        const x = src[v.offset + i * v.stride + c] * scale;
        return v.normalized && x < -1 ? -1 : x;
      };
      if (name === 'position') {
        for (let i = 0; i < g.count; i++) {
          const x = at(i, 0), y = at(i, 1), z = at(i, 2), k = base + i * 3;
          o[k] = m[0] * x + m[4] * y + m[8] * z + m[12];
          o[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          o[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
      } else if (name === 'normal') {
        const n = normalMatrix(m);
        for (let i = 0; i < g.count; i++) {
          const x = at(i, 0), y = at(i, 1), z = at(i, 2), k = base + i * 3;
          const nx = n[0] * x + n[3] * y + n[6] * z, ny = n[1] * x + n[4] * y + n[7] * z, nz = n[2] * x + n[5] * y + n[8] * z;
          const l = Math.hypot(nx, ny, nz) || 1;
          o[k] = nx / l; o[k + 1] = ny / l; o[k + 2] = nz / l;
        }
      } else {
        for (let i = 0; i < g.count; i++) for (let c = 0; c < s; c++) o[base + i * s + c] = at(i, c);
      }
    }
    const ix = g.index ? arr(g.index.buf, g.index.kind) : null, io = g.index?.offset ?? 0;
    const n = g.index ? g.index.length : g.count;
    for (let t = 0; t < n; t += 3) {
      const a = ix ? ix[io + t] : t, b = ix ? ix[io + t + 1] : t + 1, c = ix ? ix[io + t + 2] : t + 2;
      // a mirrored part: the same triangle the other way round
      index.set([vAt + a, vAt + (p.flip ? c : b), vAt + (p.flip ? b : c)], iAt + t);
    }
    vAt += g.count;
    iAt += n;
  }
  // the bounding sphere here too: on the window's thread it was half a second over the whole map
  const p = attrs.get('position')?.array ?? new Float32Array(0);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) r2 = Math.max(r2, (p[i] - cx) ** 2 + (p[i + 1] - cy) ** 2 + (p[i + 2] - cz) ** 2);
  return { id: job.id, attrs: [...attrs], index, sphere: [cx, cy, cz, Math.sqrt(r2)] };
}

// as a worker: the buffers and a batch of jobs in, the merged meshes out, their buffers handed over
const scope = globalThis as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown, t: Transferable[]) => void; document?: unknown; location?: { origin: string } };
if (typeof scope.document === 'undefined' && typeof self !== 'undefined') {
  scope.onmessage = (e: MessageEvent<{ buffers: ArrayBuffer[]; geos: Geo[]; jobs: Job[] }>) => {
    // a dedicated worker hears only the window that made it (origin ''); anything else is not its
    if (e.origin !== '' && e.origin !== scope.location?.origin) return;
    const out = e.data.jobs.map((j) => merge(e.data.buffers, e.data.geos, j));
    const transfer: Transferable[] = [];
    for (const m of out) { transfer.push(m.index.buffer); for (const [, a] of m.attrs) transfer.push(a.array.buffer); }
    scope.postMessage(out, transfer);
  };
}
