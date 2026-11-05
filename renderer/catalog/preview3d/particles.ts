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
uniform float uBright;
varying vec4 vTint;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float soft = pow(clamp(1.0 - r, 0.0, 1.0), 1.6);
  gl_FragColor = vec4(vTint.rgb * uBright, vTint.a * soft);
}`;

const rand = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
const randV = (a: V3, b: V3) => new THREE.Vector3(rand([a[0], b[0]]), rand([a[1], b[1]]), rand([a[2], b[2]]));
const tmp3 = new THREE.Matrix3();

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
  private readonly cp: (n: number) => THREE.Matrix4;
  private readonly src: () => THREE.Matrix4;
  private readonly surface: () => THREE.Vector3 | null;

  constructor(s: ParticleSpec, cp: (n: number) => THREE.Matrix4, src: () => THREE.Matrix4, surface: () => THREE.Vector3 | null, px: { value: number }) {
    this.s = s;
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
      blending: s.draw === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uPx: px, uBright: { value: s.draw === 'add' ? s.bright : 1 } },
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
    if (sp.noise) v.add(this.through(src, randV(...sp.noise)));
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.age[i] = 0;
    this.life[i] = Math.max(0.05, rand(this.s.life));
    const k = Math.random();
    const [c0, c1] = this.s.colors;
    this.base.set([rand(this.s.radius) * 2 * src.getMaxScaleOnAxis(), rand(this.s.alpha),
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

  /** Start the emitters again, as the effect is played anew; the particles in the air stay, and a lasting glow is not doubled. */
  restart(): void { if (this.s.mortal) { this.time = 0; this.acc = 0; this.burst = false; } }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Every system the hero brings, in the scene.
 * @param src      the hero model's root, whose matrix takes Source's axes and inches to the scene's
 * @param viewPx   pixels per unit of size at one unit away: the canvas height over 2 tan(fov / 2)
 */
export function playParticles(scene: THREE.Scene, list: { spec: ParticleSpec; self: Carrier }[], hero: Carrier, src: THREE.Object3D) {
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
        const bone = att ? first.bones.get(att.bone) || second.bones.get(att.bone) || hero.bones.get(att.bone) : null;
        if (!att || !bone) return srcMatrix();
        return new THREE.Matrix4().compose(new THREE.Vector3(...att.offset), new THREE.Quaternion(...att.rotation), new THREE.Vector3(1, 1, 1))
          .premultiply(bone.matrixWorld);
      };
      const sys = new System(s, cp, srcMatrix, () => (s.spawn.cp === 0 && s.cps.get(0)?.entity === 'self' ? self : hero).surface(), px);
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
    /** Play every system again from its start, as the loadout begins anew. */
    restart(): void { for (const s of systems) s.restart(); },
    dispose(): void { for (const s of systems) { s.points.removeFromParent(); s.dispose(); } },
  };
}
