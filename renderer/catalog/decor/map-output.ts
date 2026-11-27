/* The map drawn as the game draws its frame: into a picture of linear light in half floats (the
 * game's R16G16B16A16_FLOAT, RenderDoc 2026-11-27), the tonemap and the screen's sRGB laid over it
 * once, at the end (map-light.ts GAME_TONEMAP).
 *
 * Drawn straight to the canvas, three tonemaps and encodes each pixel in its material's own shader,
 * so whatever blends over another blends the encoded values. An additive glow's faint layers then
 * add up as sRGB: ten layers of 0.001 light come to 0.13 on the screen where the game, adding
 * them as light, gets 0.03. The Dire's light rays shone four times the game's, the river's foam
 * three. Blended here, they add as light, as the game adds them. */
import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface MapOutput {
  /** The picture the map draws into, sized to the canvas: for the frame and for its warm-up. */
  target(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget;
  /** The scene into the picture, the picture tonemapped onto the canvas. */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export function mapOutput(): MapOutput {
  let picture: THREE.WebGLRenderTarget | null = null;
  const pass = new OutputPass();
  pass.renderToScreen = true;
  const size = new THREE.Vector2();
  const target = (renderer: THREE.WebGLRenderer) => {
    renderer.getDrawingBufferSize(size);
    if (!picture || picture.width !== size.x || picture.height !== size.y) {
      picture?.dispose();
      // four samples: the canvas's own antialiasing, which a picture of its own does not inherit
      picture = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    }
    return picture;
  };
  return {
    target,
    draw(renderer, scene, camera) {
      const into = target(renderer);
      renderer.setRenderTarget(into);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      // to the screen: the pass writes to no picture of its own
      pass.render(renderer, null as unknown as THREE.WebGLRenderTarget, into, 0, false);
    },
    dispose() {
      picture?.dispose();
      pass.dispose();
    },
  };
}
