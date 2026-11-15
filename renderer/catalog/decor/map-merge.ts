/* The map's ~21 000 objects merged into a few hundred, so turning the camera is not ~21 000 draw
 * calls a frame (10-15 FPS on a gaming card). Meshes merge when they wear the same material and
 * switch together: the same group of the Optimization window, or the same tree model. Each mesh
 * is baked into the map's space first, so the merged mesh needs no transform of its own. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { kindOf, merge, type Geo, type Job, type Merged, type Part } from './merge-worker.ts';

/** Each triangle's second and third corners swapped: the same triangles, facing the other way. */
export function flipWinding(geo: THREE.BufferGeometry): void {
  const index = geo.index;
  if (!index) return;
  const a = index.array;
  for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  index.needsUpdate = true;
}

/** Which attributes a geometry has: only geometries with the same ones merge. */
const shapeOf = (g: THREE.BufferGeometry): string => `${Object.keys(g.attributes).sort().join(',')}|${g.index ? 'i' : 'n'}`;

/**
 * The meshes merged per key (and per material and shape within it), each merged mesh added to
 * `parent`; the originals are taken out of the scene and their geometry freed. Returns the merged
 * meshes by key, for a switch to hide.
 */
export function mergeMeshes(meshes: THREE.Mesh[], keyOf: (m: THREE.Mesh) => string, parent: THREE.Object3D): Map<string, THREE.Mesh[]> {
  const buckets = new Map<string, { key: string; material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const out = new Map<string, THREE.Mesh[]>();
  for (const mesh of meshes) {
    // a mesh with more than one material stays whole, moved under `parent` where it stood (three
    // gives each glTF primitive a mesh of its own, so this is rare)
    if (Array.isArray(mesh.material)) {
      parent.attach(mesh);
      out.set(keyOf(mesh), [...(out.get(keyOf(mesh)) ?? []), mesh]);
      continue;
    }
    const key = keyOf(mesh);
    const id = `${key}|${mesh.material.uuid}|${shapeOf(mesh.geometry)}`;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    // a mirrored prop (Dire has many) turns its triangles inside out when its transform is baked
    // in: three flips the front face for such an object, a merged mesh cannot, and a double-sided
    // material lights it from behind, black. Its triangles go the other way round instead.
    if (mesh.matrixWorld.determinant() < 0) flipWinding(geo);
    const b = buckets.get(id) ?? { key, material: mesh.material, geos: [] };
    b.geos.push(geo);
    buckets.set(id, b);
    mesh.geometry.dispose();
    mesh.removeFromParent();
  }
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    // see-through water would lay a solid shadow on its own riverbed
    mesh.castShadow = !b.material.transparent;
    mesh.receiveShadow = true;
    // the map does not move: no matrix work per frame
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    out.set(b.key, [...(out.get(b.key) ?? []), mesh]);
  }
  return out;
}

/** How many threads merge the map: half the cores, two to six (one per core would starve the window). */
const POOL = Math.min(6, Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

type Typed = ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number; BYTES_PER_ELEMENT: number };

/**
 * One thread's geometries packed into one buffer of their own, handed over rather than copied: a
 * message copies the whole buffer a typed array lies in, and the map's attributes all lie in a few
 * buffers of seventy megabytes, sent to every thread. Each attribute's bytes go in once, aligned.
 */
class Pack {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private placed = new Map<string, number>();
  /** Where these bytes of a buffer are in the pack, in bytes; the same bytes are put in once. */
  put(buffer: ArrayBufferLike, byteOffset: number, byteLength: number): number {
    const key = `${byteOffset}|${byteLength}`;
    const had = this.placed.get(key + '|' + bufKey(buffer));
    if (had !== undefined) return had;
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.size += pad; }
    const at = this.size;
    this.chunks.push(new Uint8Array(buffer as ArrayBuffer, byteOffset, byteLength));
    this.size += byteLength;
    this.placed.set(key + '|' + bufKey(buffer), at);
    return at;
  }
  done(): ArrayBuffer {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const c of this.chunks) { out.set(c, at); at += c.length; }
    return out.buffer;
  }
}
const bufKeys = new WeakMap<object, number>();
let nextBuf = 0;
function bufKey(b: ArrayBufferLike): number {
  let k = bufKeys.get(b);
  if (k === undefined) { k = nextBuf++; bufKeys.set(b, k); }
  return k;
}

/** A geometry's attributes and index copied into a thread's pack, and where each now lies. */
function describe(g: THREE.BufferGeometry, pack: Pack): Geo {
  const attrs: Geo['attrs'] = {};
  let count = 0;
  for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute][]) {
    count = a.count;
    if ('isInterleavedBufferAttribute' in a && a.isInterleavedBufferAttribute) {
      const arr = a.data.array as unknown as Typed;
      const el = arr.BYTES_PER_ELEMENT;
      const at = pack.put(arr.buffer, arr.byteOffset, a.data.count * a.data.stride * el);
      attrs[name] = { buf: 0, kind: kindOf(arr), offset: at / el + a.offset, stride: a.data.stride, size: a.itemSize, normalized: a.normalized, count: a.count };
    } else {
      const arr = (a as THREE.BufferAttribute).array as unknown as Typed;
      const el = arr.BYTES_PER_ELEMENT;
      const at = pack.put(arr.buffer, arr.byteOffset, a.count * a.itemSize * el);
      attrs[name] = { buf: 0, kind: kindOf(arr), offset: at / el, stride: a.itemSize, size: a.itemSize, normalized: a.normalized, count: a.count };
    }
  }
  const ix = g.index ? (g.index.array as unknown as Typed) : null;
  const index = ix ? { buf: 0, kind: kindOf(ix), offset: pack.put(ix.buffer, ix.byteOffset, g.index!.count * ix.BYTES_PER_ELEMENT) / ix.BYTES_PER_ELEMENT, length: g.index!.count } : null;
  return { attrs, index, count };
}

/**
 * The same as mergeMeshes, the merging done by a few workers side by side, off the window's
 * thread: merged on it, the map's ~21 000 meshes held the window for three and a half seconds.
 * A geometry many meshes share (a tree model stands thousands of times) goes to a worker once.
 */
export async function mergeMeshesAsync(meshes: THREE.Mesh[], keyOf: (m: THREE.Mesh) => string, parent: THREE.Object3D): Promise<Map<string, THREE.Mesh[]>> {
  const out = new Map<string, THREE.Mesh[]>();
  const geoId = new Map<THREE.BufferGeometry, number>();
  const geos: THREE.BufferGeometry[] = [];
  const buckets = new Map<string, { key: string; material: THREE.Material; parts: Part[]; verts: number }>();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) {
      parent.attach(mesh);
      out.set(keyOf(mesh), [...(out.get(keyOf(mesh)) ?? []), mesh]);
      continue;
    }
    const key = keyOf(mesh);
    const id = `${key}|${mesh.material.uuid}|${shapeOf(mesh.geometry)}`;
    let g = geoId.get(mesh.geometry);
    if (g === undefined) { g = geos.length; geos.push(mesh.geometry); geoId.set(mesh.geometry, g); }
    const b = buckets.get(id) ?? { key, material: mesh.material, parts: [], verts: 0 };
    b.parts.push({ geo: g, matrix: mesh.matrixWorld.elements.slice(), flip: mesh.matrixWorld.determinant() < 0 });
    b.verts += mesh.geometry.attributes.position?.count ?? 0;
    buckets.set(id, b);
    mesh.removeFromParent();
  }
  const list = [...buckets.values()];
  // the biggest first, each to the thread with the least to do
  const order = list.map((b, i) => i).sort((a, b) => list[b].verts - list[a].verts);
  const loads = Array.from({ length: Math.min(POOL, Math.max(1, list.length)) }, () => ({ jobs: [] as Job[], verts: 0 }));
  for (const i of order) {
    const w = loads.reduce((x, y) => (y.verts < x.verts ? y : x));
    w.jobs.push({ id: i, parts: list[i].parts });
    w.verts += list[i].verts;
  }
  const results = await Promise.all(loads.map(async (load) => {
    // each thread gets the geometries its jobs use, packed into one buffer it is handed
    const local = new Map<number, number>();
    const pack = new Pack();
    const sent: Geo[] = [];
    const jobs = load.jobs.map((j) => ({ id: j.id, parts: j.parts.map((p) => {
      let n = local.get(p.geo);
      if (n === undefined) { n = sent.length; sent.push(describe(geos[p.geo], pack)); local.set(p.geo, n); }
      return { ...p, geo: n };
    }) }));
    const buffers = [pack.done()];
    try {
      const worker = new Worker(new URL('./merge-worker.ts', import.meta.url), { type: 'module' });
      const done = await new Promise<Merged[]>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<Merged[]>) => resolve(e.data);
        worker.onerror = (e) => reject(e);
        worker.postMessage({ buffers, geos: sent, jobs }, buffers);
      });
      worker.terminate();
      return done;
    } catch {
      // no worker to be had: the same merge here
      return jobs.map((j) => merge(buffers, sent, j));
    }
  }));
  for (const g of geos) g.dispose();
  for (const m of results.flat()) {
    const b = list[m.id];
    const geo = new THREE.BufferGeometry();
    for (const [name, a] of m.attrs) geo.setAttribute(name, new THREE.BufferAttribute(a.array, a.size));
    geo.setIndex(new THREE.BufferAttribute(m.index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(m.sphere[0], m.sphere[1], m.sphere[2]), m.sphere[3]);
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = !b.material.transparent;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    out.set(b.key, [...(out.get(b.key) ?? []), mesh]);
  }
  return out;
}
