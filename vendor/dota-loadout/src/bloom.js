// Bloom, as the game's post-processing has it: what is brighter than white in the scene's linear
// light (glows, fire, a gem's lit swords) bleeds a soft halo around it. A dual-filter blur: the
// bright part halved down a chain of smaller targets, then added back up level by level.
import * as THREE from 'three';

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
// What glows: each pixel's colour past the threshold, eased in over a knee (no hard edge).
const BRIGHT = `uniform sampler2D tIn; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
vec3 bright(vec2 uv) { vec3 c = texture2D(tIn, uv).rgb;
  // A stray pixel of no number or no end (a material's 0/0) would spread over the whole halo.
  if (any(isnan(c)) || any(isinf(c))) return vec3(0.0); c = min(c, vec3(64.0)); float l = max(c.r, max(c.g, c.b)), k = clamp(l - uThreshold + 0.5, 0.0, 1.0);
  float w = max(l - uThreshold, 0.0) + k * k * 0.5; return c * w / max(l, 1e-4); }
void main() { vec2 d = uTexel * 0.5;
  gl_FragColor = vec4((bright(vUv) * 4.0 + bright(vUv + vec2(-d.x, -d.y)) + bright(vUv + vec2(d.x, -d.y)) + bright(vUv + vec2(-d.x, d.y)) + bright(vUv + d)) / 8.0, 1.0); }`;
const DOWN = `uniform sampler2D tIn; uniform vec2 uTexel; varying vec2 vUv;
void main() { vec2 d = uTexel * 0.5;
  gl_FragColor = vec4((texture2D(tIn, vUv).rgb * 4.0 + texture2D(tIn, vUv - d).rgb + texture2D(tIn, vUv + d).rgb + texture2D(tIn, vUv + vec2(d.x, -d.y)).rgb + texture2D(tIn, vUv - vec2(d.x, -d.y)).rgb) / 8.0, 1.0); }`;
const UP = `uniform sampler2D tIn; uniform vec2 uTexel; varying vec2 vUv;
void main() { vec2 d = uTexel * 0.5; vec3 s = vec3(0.0);
  s += texture2D(tIn, vUv + vec2(-d.x * 2.0, 0.0)).rgb + texture2D(tIn, vUv + vec2(d.x * 2.0, 0.0)).rgb + texture2D(tIn, vUv + vec2(0.0, -d.y * 2.0)).rgb + texture2D(tIn, vUv + vec2(0.0, d.y * 2.0)).rgb;
  s += (texture2D(tIn, vUv + vec2(-d.x, d.y)).rgb + texture2D(tIn, vUv + d).rgb + texture2D(tIn, vUv + vec2(d.x, -d.y)).rgb + texture2D(tIn, vUv - d).rgb) * 2.0;
  gl_FragColor = vec4(s / 12.0, 1.0); }`;

export class Bloom {
  // levels: how far the halo reaches (each halves the size); threshold: the brightness it starts at.
  constructor({ levels = 6, threshold = 1 } = {}) {
    const target = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.targets = Array.from({ length: levels }, target);
    const pass = (fragmentShader, blending = THREE.NoBlending) => new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: threshold } }, vertexShader: VERTEX, fragmentShader,
      depthTest: false, depthWrite: false, toneMapped: false, blending, ...(blending === THREE.CustomBlending ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation } : {}),
    });
    this.bright = pass(BRIGHT); this.down = pass(DOWN); this.up = pass(UP, THREE.CustomBlending);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.camera = new THREE.OrthographicCamera();
  }
  get texture() { return this.targets[0].texture; }
  setSize(w, h) { this.targets.forEach((t, i) => t.setSize(Math.max(1, Math.ceil(w / 2 ** (i + 1))), Math.max(1, Math.ceil(h / 2 ** (i + 1))))); }
  draw(r, material, input, target) {
    material.uniforms.tIn.value = input.texture; material.uniforms.uTexel.value.set(1 / input.width, 1 / input.height);
    this.quad.material = material; r.setRenderTarget(target); r.render(this.quad, this.camera);
  }
  // The halo of a scene drawn into source (a render target), left in this.texture.
  render(r, source) {
    const t = this.targets, clear = r.autoClear;
    this.draw(r, this.bright, source, t[0]);
    for (let i = 1; i < t.length; i++) this.draw(r, this.down, t[i - 1], t[i]);
    // Up the chain, each level added onto the one above (which keeps its own).
    r.autoClear = false;
    for (let i = t.length - 1; i > 0; i--) this.draw(r, this.up, t[i], t[i - 1]);
    r.autoClear = clear;
  }
  dispose() { for (const t of this.targets) t.dispose(); this.bright.dispose(); this.down.dispose(); this.up.dispose(); this.quad.geometry.dispose(); }
}
