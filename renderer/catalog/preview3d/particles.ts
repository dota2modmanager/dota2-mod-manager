/* The particles of the 3D preview (issue #417): the systems particle-def.ts made out of the game's,
 * run on the CPU and drawn as soft round sprites, additive where the game adds them.
 *
 * A control point is where the game puts it: an attachment of the item ("self") or of the hero
 * ("parent"), found by name on that model and followed each frame through its bone; or the model's
 * origin. Source vectors (an offset, a speed, gravity) go through the hero's own root transform,
 * which turns Source's axes and inches into the scene's, or through the control point's, where the
 * game reads them in its local frame. */
import * as THREE from 'three';
import type { Attachment } from '../../api/preview3d.ts';
import type { ParticleSpec, V3 } from './particle-def.ts';
import { coverGain, crowdGain } from './gain.ts';

/** A model that carries particles: its bones by name, its attachment points, and points on its surface. */
export interface Carrier { bones: Map<string, THREE.Bone>; attachments: Attachment[]; surface: () => THREE.Vector3 | null }

const vertexShader = /* glsl */`
attribute vec4 tint;
attribute float size;
uniform float uPx;
varying vec4 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, size * uPx / max(-mv.z, 0.001));
  gl_Position = projectionMatrix * mv;
}`;
const fragmentShader = /* glsl */`
uniform float uBright, uHasTex;
uniform sampler2D uTex;
varying vec4 vTint;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (uHasTex > 0.5) {
    // one frame of a sheet, or a texture with no alpha of its own: its edge fades, never a square
    vec4 t = texture2D(uTex, gl_PointCoord) * smoothstep(1.0, 0.6, r);
    gl_FragColor = vec4(vTint.rgb * t.rgb * uBright, vTint.a * t.a);
    return;
  }
  // a glow that falls off from its middle, as a sprite of smoke or fire does, not a lit disc
  float soft = exp(-r * r * 5.0) * step(r, 1.0);
  gl_FragColor = vec4(vTint.rgb * uBright, vTint.a * soft);
}`;

const rand = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
const randV = (a: V3, b: V3) => new THREE.Vector3(rand([a[0], b[0]]), rand([a[1], b[1]]), rand([a[2], b[2]]));
/** A point inside the ellipsoid these corners bound: the game's velocity noise is smooth, and drawn in a box it grew a box of snow. */
const randIn = (a: V3, b: V3) => {
  const d = new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()));
  return new THREE.Vector3((a[0] + b[0]) / 2 + d.x * (b[0] - a[0]) / 2, (a[1] + b[1]) / 2 + d.y * (b[1] - a[1]) / 2, (a[2] + b[2]) / 2 + d.z * (b[2] - a[2]) / 2);
};
const tmp3 = new THREE.Matrix3();
/** The game's sprites are textures mostly empty around a wisp; a solid soft dot carries more
 * light than they do, so an additive one gives back this share of it. */
const ADD_GAIN = 0.5;
/** Narrower than this, a sprite's frame is drawn as a dot, with this share of the light. */
const SPECK = 24;
const SPECK_GAIN = 0.35;
class System {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly tint: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly base: Float32Array;
  private alive = 0;
  private acc = 0;
  private time = 0;
  private burst = false;
  private lockAt: THREE.Vector3 | null = null;

  private readonly s: ParticleSpec;
  private readonly gain: number;
  private readonly cp: (n: number) => THREE.Matrix4;
  private readonly src: () => THREE.Matrix4;
  private readonly surface: () => THREE.Vector3 | null;

  constructor(s: ParticleSpec, cp: (n: number) => THREE.Matrix4, src: () => THREE.Matrix4, surface: () => THREE.Vector3 | null, px: { value: number },
    tex: THREE.Texture | null) {
    this.s = s;
    // a texture carries its own wisp and falls off as the game draws it; a plain dot needs the share
    // a sprite drawn as a dot in place of its picture: the picture was mostly empty around a speck
    this.gain = coverGain(s) * (s.draw === 'add' ? crowdGain(s) : 1) * (s.texture && !tex ? SPECK_GAIN : 1);
    this.cp = cp;
    this.src = src;
    this.surface = surface;
    const n = s.max;
    this.pos = new Float32Array(n * 3);
    this.tint = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    // per particle: radius, alpha, r, g, b
    this.base = new Float32Array(n * 5);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false,
      // added light leaves the canvas's alpha alone: the stage's colour is behind it, and a sprite's dark
      // corners written as opaque would cover it with a black square
      blending: s.draw === 'add' ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uPx: px, uBright: { value: s.draw === 'add' ? Math.min(2, s.bright) * (tex ? 1 : ADD_GAIN) : 1 },
        uTex: { value: tex }, uHasTex: { value: tex ? 1 : 0 },
      },
    }));
    this.points.frustumCulled = false;
    this.points.visible = s.draw !== 'none';
  }

  /** A Source vector through a matrix, its scale and turn kept. */
  private through(m: THREE.Matrix4, v: THREE.Vector3): THREE.Vector3 { return v.applyMatrix3(tmp3.setFromMatrix4(m)); }

  private spawn(): void {
    if (this.alive >= this.s.max) return;
    const i = this.alive++;
    const sp = this.s.spawn;
    const at = this.cp(sp.cp);
    const src = this.src();
    const p = new THREE.Vector3().setFromMatrixPosition(at);
    const v = new THREE.Vector3();
    const onModel = sp.onModel ? this.surface() : null;
    if (onModel) p.copy(onModel);
    if (sp.ring) {
      const a = Math.random() * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      p.add(this.through(at, d.clone().multiplyScalar(sp.ring.radius)));
      v.add(this.through(at, d.multiplyScalar(rand(sp.ring.speed))));
    }
    if (sp.sphere[1] > 0 || sp.speed[1] !== 0) {
      const d = new THREE.Vector3().randomDirection().multiply(new THREE.Vector3(...sp.bias)).normalize();
      p.add(this.through(at, d.clone().multiplyScalar(rand(sp.sphere))));
      v.add(this.through(at, d.multiplyScalar(rand(sp.speed))));
    }
    if (sp.offset) p.add(this.through(sp.localOffset ? at : src, randV(...sp.offset)));
    if (sp.local) v.add(this.through(at, randV(...sp.local)));
    if (sp.noise) v.add(this.through(src, randIn(...sp.noise)));
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.age[i] = 0;
    this.life[i] = Math.max(0.05, rand(this.s.life));
    const k = Math.random();
    const [c0, c1] = this.s.colors;
    this.base.set([rand(this.s.radius) * 2 * src.getMaxScaleOnAxis(), rand(this.s.alpha) * this.gain,
      c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k], i * 5);
  }

  private kill(i: number): void {
    const last = --this.alive;
    if (i === last) return;
    for (const [arr, w] of [[this.pos, 3], [this.vel, 3], [this.base, 5]] as const) arr.copyWithin(i * w, last * w, last * w + w);
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
  }

  update(dt: number): void {
    const s = this.s;
    this.time += dt;
    if (this.time >= s.start) {
      if (!this.burst) { this.burst = true; for (let k = 0; k < s.burst; k++) this.spawn(); }
      if (s.rate > 0 && (s.duration <= 0 || this.time - s.start < s.duration)) {
        this.acc += s.rate * dt;
        for (; this.acc >= 1; this.acc--) this.spawn();
      }
    }
    const src = this.src();
    const g = this.through(src, new THREE.Vector3(...s.gravity)).multiplyScalar(dt);
    const jitter = s.jitter * src.getMaxScaleOnAxis() * dt * 20;
    const keep = s.drag > 0 ? Math.pow(Math.max(0, 1 - s.drag), dt * 30) : 1;
    let shift: THREE.Vector3 | null = null;
    if (s.lock !== null) {
      const now = new THREE.Vector3().setFromMatrixPosition(this.cp(s.lock));
      if (this.lockAt) shift = now.clone().sub(this.lockAt);
      this.lockAt = now;
    }
    for (let i = this.alive - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i] && s.mortal) { this.kill(i); continue; }
      const j = i * 3;
      this.vel[j] = (this.vel[j] + g.x + (Math.random() - 0.5) * jitter) * keep;
      this.vel[j + 1] = (this.vel[j + 1] + g.y + (Math.random() - 0.5) * jitter) * keep;
      this.vel[j + 2] = (this.vel[j + 2] + g.z + (Math.random() - 0.5) * jitter) * keep;
      this.pos[j] += this.vel[j] * dt + (shift?.x || 0);
      this.pos[j + 1] += this.vel[j + 1] * dt + (shift?.y || 0);
      this.pos[j + 2] += this.vel[j + 2] * dt + (shift?.z || 0);
    }
    for (let i = 0; i < this.alive; i++) {
      const t = Math.min(1, this.age[i] / this.life[i]);
      const b = i * 5;
      let a = this.base[b + 1];
      if (s.fadeIn > 0 && t < s.fadeIn) a *= t / s.fadeIn;
      if (s.fadeOut > 0 && t > 1 - s.fadeOut) a *= (1 - t) / s.fadeOut;
      const z = s.size;
      const st = Math.min(1, Math.max(0, (t - z.start) / Math.max(1e-3, z.end - z.start)));
      this.size[i] = this.base[b] * (z.from + (z.to - z.from) * st);
      let [r, gg, bb] = [this.base[b + 2], this.base[b + 3], this.base[b + 4]];
      if (s.fade) {
        const f = Math.min(1, Math.max(0, (t - s.fade.start) / Math.max(1e-3, s.fade.end - s.fade.start)));
        [r, gg, bb] = [r + (s.fade.color[0] - r) * f, gg + (s.fade.color[1] - gg) * f, bb + (s.fade.color[2] - bb) * f];
      }
      this.tint.set([r, gg, bb, a], i * 4);
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.alive);
    for (const name of ['position', 'tint', 'size']) (geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Take in where its particles are now. */
  expand(box: THREE.Box3): void {
    for (let i = 0; i < this.alive; i++) box.expandByPoint(new THREE.Vector3().fromArray(this.pos, i * 3));
  }

  /** Start the emitters again, as the effect is played anew; the particles in the air stay, and a lasting glow is not doubled. */
  restart(): void { if (this.s.mortal) { this.time = 0; this.acc = 0; this.burst = false; } }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** The sprites the main process sent (PNG bytes by texture path) as textures the shader samples. */
export async function spriteTextures(sprites: Record<string, Uint8Array>): Promise<Map<string, THREE.Texture>> {
  const out = new Map<string, THREE.Texture>();
  await Promise.all(Object.entries(sprites).map(async ([path, bytes]) => {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
      // a frame of a few pixels (fleks3: 15 by 9) blown up to a sprite is a glyph, not a speck: those stay dots
      if (bitmap.width < SPECK) return;
      const tex = new THREE.Texture(bitmap);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.needsUpdate = true;
      out.set(path, tex);
    } catch { /* a picture the window cannot decode: that system stays a glow */ }
  }));
  return out;
}

/**
 * Every system the hero brings, in the scene.
 * @param src      the hero model's root, whose matrix takes Source's axes and inches to the scene's
 * @param viewPx   pixels per unit of size at one unit away: the canvas height over 2 tan(fov / 2)
 */
export function playParticles(scene: THREE.Scene, list: { spec: ParticleSpec; self: Carrier }[], hero: Carrier, src: THREE.Object3D,
  textures: Map<string, THREE.Texture> = new Map()) {
  const px = { value: 500 };
  const systems: System[] = [];
  const srcMatrix = () => src.matrixWorld;
  for (const { spec, self } of list) {
    const add = (s: ParticleSpec) => {
      const cp = (n: number): THREE.Matrix4 => {
        const c = s.cps.get(n) || s.cps.get(0);
        if (!c) return srcMatrix();
        // a point set off another: the offset is in the hero's axes, from where that point is
        if (c.world) {
          const m = new THREE.Matrix4().copy(srcMatrix());
          if (c.from !== undefined && c.from !== n) m.setPosition(new THREE.Vector3().setFromMatrixPosition(cp(c.from)));
          return m.multiply(new THREE.Matrix4().makeTranslation(...c.world));
        }
        const [first, second] = c.entity === 'self' ? [self, hero] : [hero, self];
        const att = c.attachment ? first.attachments.find((a) => a.name === c.attachment) || second.attachments.find((a) => a.name === c.attachment) : null;
        const key = att?.bone.toLowerCase() ?? '';
        const bone = att ? first.bones.get(key) || second.bones.get(key) || hero.bones.get(key) : null;
        if (!att || !bone) return srcMatrix();
        return new THREE.Matrix4().compose(new THREE.Vector3(...att.offset), new THREE.Quaternion(...att.rotation), new THREE.Vector3(1, 1, 1))
          .premultiply(bone.matrixWorld);
      };
      const sys = new System(s, cp, srcMatrix, () => (s.spawn.cp === 0 && s.cps.get(0)?.entity === 'self' ? self : hero).surface(), px,
        (s.texture && textures.get(s.texture)) || null);
      sys.points.name = s.path;
      systems.push(sys);
      scene.add(sys.points);
      s.children.forEach(add);
    };
    add(spec);
  }
  return {
    update(dt: number, viewPx: number): void {
      px.value = viewPx;
      const step = Math.min(dt, 0.05);
      for (const s of systems) s.update(step);
    },
    /** Where every particle is now, for a camera to frame them. */
    bounds(): THREE.Box3 { const box = new THREE.Box3(); for (const s of systems) if (s.points.visible) s.expand(box); return box; },
    /** Play every system again from its start, as the loadout begins anew. */
    restart(): void { for (const s of systems) s.restart(); },
    dispose(): void { for (const s of systems) { s.points.removeFromParent(); s.dispose(); } },
  };
}
