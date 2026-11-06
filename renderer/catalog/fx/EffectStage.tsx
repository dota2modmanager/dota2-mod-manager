/* The effect editor's picture: the effect playing, in the same particles the 3D preview has
 * (preview3d/particles.ts). The camera is set once for an effect, so a larger effect reads as larger.
 * It plays once, as the game plays it, and again after a change or when asked (`play`). */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { particleSpec, type ParticleSpec } from '../preview3d/particle-def.ts';
import { playParticles, spriteTextures } from '../preview3d/particles.ts';
import { EMPTY_CARRIER, SOURCE_AXES } from '../preview3d/effect-thumb.ts';
import type { ParticleDef } from '../../api/preview3d.ts';

const FOV = 30;
const WARM = 2.5; // seconds run before the camera is set, for the effect to fill out
const MIN_VIEW = 2.2; // metres the picture shows at least: a hero is about two, and one sprite must not fill it

/** The widest sprite of a system and its children, in metres: the bounds hold only where particles are. */
const widest = (s: ParticleSpec): number => Math.max(s.draw === 'none' ? 0 : s.radius[1] * 0.0254, ...s.children.map(widest));

/** Whether any system of it is drawn in sprites: a model, a light or a shake has nothing to show here. */
export const hasSprites = (s: ParticleSpec): boolean => s.draw !== 'none' || s.children.some(hasSprites);

export function EffectStage({ path, defs, sprites, play }: { path: string; defs: ParticleDef[]; sprites: Record<string, Uint8Array>; play: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gl = useRef<THREE.WebGLRenderer | null>(null);
  const fit = useRef<{ path: string; camera: THREE.PerspectiveCamera } | null>(null);
  const textures = useRef<{ path: string; got: Awaited<ReturnType<typeof spriteTextures>> } | null>(null);

  useEffect(() => {
    if (!canvas.current) return undefined;
    const r = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    gl.current = r;
    return () => { r.dispose(); gl.current = null; };
  }, []);

  useEffect(() => {
    const r = gl.current;
    const el = canvas.current;
    if (!r || !el) return undefined;
    let stopped = false;
    let frame = 0;
    let done = () => {};
    void (async () => {
      if (textures.current?.path !== path) textures.current = { path, got: await spriteTextures(sprites) };
      if (stopped) return;
      const w = el.clientWidth || 640;
      const h = el.clientHeight || 360;
      r.setSize(w, h, false);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0e0d14);
      const src = new THREE.Object3D();
      src.matrixAutoUpdate = false;
      src.matrix.copy(SOURCE_AXES);
      scene.add(src);
      src.updateMatrixWorld(true);
      const viewPx = h / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
      const specs = defs.map((d) => particleSpec(d));
      const start = () => playParticles(scene, specs.map((spec) => ({ spec, self: EMPTY_CARRIER })), EMPTY_CARRIER, src, textures.current?.got ?? new Map());
      if (fit.current?.path !== path) {
        // a run of its own to see how far it reaches: what is played starts from nothing
        const probe = start();
        for (let t = 0; t < WARM; t += 1 / 30) probe.update(1 / 30, viewPx);
        const box = probe.bounds();
        probe.dispose();
        if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(1, 1, 1));
        const view = Math.max(MIN_VIEW, ...specs.map((s) => widest(s) * 2.4));
        const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(view, view, view));
        const centre = box.getCenter(new THREE.Vector3());
        const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const d = Math.max(size.y / 2 / tan, size.x / 2 / (tan * (w / h))) * 1.5 + size.z / 2;
        const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.01, 200);
        camera.position.set(centre.x, centre.y + d * 0.15, centre.z + d);
        camera.lookAt(centre);
        fit.current = { path, camera };
      }
      const fx = start();
      const camera = fit.current?.camera as THREE.PerspectiveCamera;
      let last = performance.now();
      const tick = (now: number) => {
        if (stopped) return;
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        fx.update(dt, viewPx);
        r.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      done = () => fx.dispose();
    })();
    return () => { stopped = true; cancelAnimationFrame(frame); done(); };
  }, [path, defs, sprites, play]);

  return <canvas ref={canvas} className="fx-canvas" id="fxCanvas" aria-label={path} />;
}
