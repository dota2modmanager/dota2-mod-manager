/* The glow of the 3D preview. The game draws in more light than a screen shows and lets what is too
 * bright bleed into its surroundings: Abaddon's horse, a gem, a spell. So the scene is drawn into a
 * floating point picture, what is over the threshold goes down a chain of ever smaller pictures and
 * back up, each step a little blur, and the result is laid over the scene before tone mapping.
 *
 * The canvas stays transparent, with the stage's backdrop behind it in the page, so the glow counts
 * as coverage too: it lights the backdrop instead of stopping at the hero's edge. */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** How much of a pixel over the line is let through, and how much of the glow goes on the picture. */
export const BLOOM = { threshold: 1, knee: 0.5, strength: 0.32 };
/** Each step is half the size of the last; five reach about a thirtieth of the stage. */
const STEPS = 5;

/** What of a colour's brightest channel `peak` is over the threshold, with a soft start: 0 under it, 1 well over. */
export function bloomShare(peak: number, threshold = BLOOM.threshold, knee = BLOOM.knee): number {
  if (peak <= 0) return 0;
  const soft = Math.min(Math.max(peak - threshold + knee, 0), 2 * knee);
  const curve = (soft * soft) / (4 * knee + 1e-5);
  return Math.max(curve, peak - threshold) / peak;
}

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const brightShader = /* glsl */`
uniform sampler2D uFrom;
uniform float uThreshold, uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uFrom, vUv).rgb;
  float peak = max(c.r, max(c.g, c.b));
  float soft = clamp(peak - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  float share = peak > 0.0 ? max(soft * soft / (4.0 * uKnee + 1e-5), peak - uThreshold) / peak : 0.0;
  gl_FragColor = vec4(min(c * share, vec3(16.0)), 1.0);
}
`;

const downShader = /* glsl */`
uniform sampler2D uFrom;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uFrom, vUv).rgb * 4.0;
  for (int x = -1; x <= 1; x += 2) for (int y = -1; y <= 1; y += 2) c += texture2D(uFrom, vUv + uTexel * vec2(x, y)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

const upShader = /* glsl */`
uniform sampler2D uFrom;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  for (int x = -1; x <= 1; x += 2) for (int y = -1; y <= 1; y += 2) {
    c += texture2D(uFrom, vUv + uTexel * vec2(x, y) * 2.0).rgb * 2.0;
    c += texture2D(uFrom, vUv + uTexel * vec2(x * 2, 0.0)).rgb * 0.5;
    c += texture2D(uFrom, vUv + uTexel * vec2(0.0, y * 2)).rgb * 0.5;
  }
  gl_FragColor = vec4(c / 12.0, 1.0);
}
`;

const finalShader = /* glsl */`
uniform sampler2D uScene, uGlow;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(uScene, vUv);
  vec3 glow = texture2D(uGlow, vUv).rgb * uStrength;
  gl_FragColor = vec4(scene.rgb + glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = clamp(scene.a + max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
}
`;

const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false) => new THREE.ShaderMaterial({
  vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped,
});

/** A drawing of `scene` with its glow, sized to the renderer's canvas by `resize`. */
export function createBloom(renderer: THREE.WebGLRenderer) {
  const picture = (w: number, h: number, samples = 0) => new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples, depthBuffer: samples > 0, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const whole = picture(1, 1, 4);
  const chain = Array.from({ length: STEPS }, () => picture(1, 1));
  const uTexel = { value: new THREE.Vector2() };
  const uFrom = { value: null as THREE.Texture | null };
  const bright = pass(brightShader, { uFrom, uThreshold: { value: BLOOM.threshold }, uKnee: { value: BLOOM.knee } });
  const down = pass(downShader, { uFrom, uTexel });
  const up = pass(upShader, { uFrom, uTexel });
  up.blending = THREE.AdditiveBlending;
  const final = pass(finalShader, { uScene: { value: whole.texture }, uGlow: { value: chain[0].texture }, uStrength: { value: BLOOM.strength } }, true);
  final.transparent = false;
  final.blending = THREE.NoBlending;
  const quad = new FullScreenQuad(bright);

  const draw = (m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null, from: THREE.Texture, source: THREE.WebGLRenderTarget | null, clear = true) => {
    uFrom.value = from;
    if (source) uTexel.value.set(1 / source.width, 1 / source.height);
    quad.material = m;
    renderer.setRenderTarget(to);
    if (clear) renderer.clear();
    quad.render(renderer);
  };

  return {
    /** The pictures for the canvas as it is now, in its real pixels. */
    resize() {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      whole.setSize(size.x, size.y);
      chain.forEach((p, i) => p.setSize(Math.max(1, size.x >> (i + 1)), Math.max(1, size.y >> (i + 1))));
    },
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renderer.setRenderTarget(whole);
      renderer.clear();
      renderer.render(scene, camera);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      draw(bright, chain[0], whole.texture, null);
      for (let i = 1; i < chain.length; i++) draw(down, chain[i], chain[i - 1].texture, chain[i - 1]);
      for (let i = chain.length - 1; i > 0; i--) draw(up, chain[i - 1], chain[i].texture, chain[i], false);
      quad.material = final;
      renderer.setRenderTarget(null);
      renderer.clear();
      quad.render(renderer);
      renderer.autoClear = autoClear;
    },
    dispose() {
      for (const p of [whole, ...chain]) p.dispose();
      for (const m of [bright, down, up, final]) m.dispose();
      quad.dispose();
    },
  };
}
