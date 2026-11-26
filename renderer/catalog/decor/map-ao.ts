/* The map's ambient occlusion, as the game draws it before its light (ssao.vfx, four passes read from
 * a frame of the game in RenderDoc, 2026-11-26): at half the screen's size, each point of the ground
 * looks at 16 points within 100 inches of it, spread over the half of a ball that faces out of the
 * surface and turned by a 4×4 picture of noise, and counts those that fall behind what the screen
 * shows there: fully when just behind, not at all when 237 inches behind or more (a wall far behind
 * a tree does not shade its foot). Two passes blur it, five points each way, among points of about
 * the same depth and facing. The light (map-light.ts) then takes (1 - occlusion)^2.1 of the sky's
 * and the shadow's light and 0.45 + 0.55 × (1 - occlusion)^1.85 of the sun's: under the river's
 * banks and among the rocks the ground goes down to a third of its light, which is most of why the
 * game's lowlands are darker than the window's were.
 *
 * The game reads the depth its geometry pass wrote; the window draws the map once more for it, at
 * half size, every material stopping as soon as it knows whether the pixel is there (map-light.ts
 * uAOPass: the leaves keep their cut-outs). Its normals the game keeps from that pass too; here they
 * come from the depth's own slopes, without the pictures' bumps. */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { INCH, lit } from './map-light.ts';

export interface MapAO {
  /** the map's occlusion for this view, into map-light.ts's lit.uAO */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

/** ssao.vfx's constants (the frame's cbuffer0), in inches: the reach, the step off the surface, the
 * depth a sample must be behind by and the depth past which it no longer counts (2500 / 10.5263). */
const RADIUS = 100 * INCH, OFF = 0.25 * INCH, BIAS = 0.001526 * 2500 * INCH, RANGE = (2500 / 10.5263) * INCH;

/** The shader's 16 directions (its immediate constant buffer). */
const KERNEL = [
  [0.615195, 0.099185, 0.468574], [-0.246664, 0.495551, 0.636662], [-0.302699, 0.197356, 0.928992], [0.329761, -0.243882, 0.453554],
  [0.228839, 0.289674, 0.13315], [-0.221339, -0.148409, 0.131756], [-0.457569, -0.666197, 0.229464], [-0.073882, 0.055014, -0.009701],
  [-0.038274, -0.039986, 0.009818], [0.745164, 0.323719, -0.429083], [-0.015386, 0.267425, -0.066036], [-0.096176, -0.522937, -0.250845],
  [0.489685, -0.464403, -0.14924], [-0.131151, 0.139137, -0.70088], [-0.362332, -0.100502, -0.306237], [0.293372, -0.170633, -0.661786],
];

/** The 4×4 noise it turns them by, as the frame had it (RGBA bytes, row by row). */
const NOISE = [
  7, 118, 84, 255, 127, 21, 198, 255, 121, 90, 249, 255, 116, 191, 17, 255,
  72, 192, 222, 255, 124, 230, 203, 255, 246, 104, 87, 255, 152, 222, 45, 255,
  22, 67, 87, 255, 182, 183, 228, 255, 108, 204, 226, 255, 146, 207, 224, 255,
  167, 79, 16, 255, 220, 175, 200, 255, 51, 56, 201, 255, 174, 25, 187, 255,
];

// the view-space point and normal of a pixel, from the depth: shared by both shaders
const VIEW = /* glsl */ `
  uniform sampler2D uDepth;
  uniform mat4 uProj, uProjInv;
  uniform vec2 uPixel;
  uniform float uNear, uFar;
  vec3 at( vec2 uv ) {
    float d = texture2D( uDepth, uv ).x;
    vec4 p = uProjInv * vec4( vec3( uv, d ) * 2.0 - 1.0, 1.0 );
    return p.xyz / p.w;
  }
  vec3 facing( vec2 uv, vec3 p ) {
    // the slope toward the nearer neighbour each way, so an edge takes the side it belongs to
    vec3 r = at( uv + vec2( uPixel.x, 0.0 ) ) - p, l = p - at( uv - vec2( uPixel.x, 0.0 ) );
    vec3 u = at( uv + vec2( 0.0, uPixel.y ) ) - p, d = p - at( uv - vec2( 0.0, uPixel.y ) );
    vec3 dx = abs( r.z ) < abs( l.z ) ? r : l, dy = abs( u.z ) < abs( d.z ) ? u : d;
    return normalize( cross( dx, dy ) );
  }`;

const occlusion = new THREE.ShaderMaterial({
  uniforms: {
    uDepth: { value: null }, uNoise: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
    uPixel: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
  fragmentShader: /* glsl */ `
    #include <common>
    varying vec2 vUv;
    uniform sampler2D uNoise;
    ${VIEW}
    const vec3 KERNEL[ 16 ] = vec3[ 16 ]( ${KERNEL.map((k) => `vec3( ${k.map((v) => v.toFixed(6)).join(', ')} )`).join(', ')} );
    void main() {
      if ( texture2D( uDepth, vUv ).x >= 1.0 ) { gl_FragColor = vec4( 0.0, 0.5, 0.5, 1.0 ); return; }
      vec3 p = at( vUv ), n = facing( vUv, p );
      vec4 r4 = texture2D( uNoise, gl_FragCoord.xy / 4.0 ) * 2.0 - 1.0;
      vec3 r = r4.xyz * inversesqrt( dot( r4, r4 ) );
      vec3 o = p + n * ${OFF.toFixed(6)};
      float occ = 0.0;
      for ( int i = 0; i < 16; i++ ) {
        vec3 k = reflect( KERNEL[ i ], r );
        if ( dot( k, n ) < 0.0 ) k = reflect( k, n );
        vec3 s = o + k * ${RADIUS.toFixed(6)};
        vec4 c = uProj * vec4( s, 1.0 );
        vec2 uv = c.xy / c.w * 0.5 + 0.5;
        // how far behind what the screen shows there the sample is (the view looks down -z)
        float behind = -s.z - -at( uv ).z - ${BIAS.toFixed(6)};
        occ += behind < 0.0 ? 0.0 : saturate( 1.0 - behind / ${RANGE.toFixed(6)} );
      }
      gl_FragColor = vec4( occ / 16.0, n * 0.5 + 0.5 );
    }`,
  depthTest: false, depthWrite: false,
});

// ssao.vfx's blur: five points along one axis a screen pixel apart (half a step of its picture), each weighed by how near its depth is (3.5%) and how
// alike its facing (from 0.7 to 1), the middle by 1
const blur = new THREE.ShaderMaterial({
  uniforms: {
    uAO: { value: null }, uStep: { value: new THREE.Vector2() },
    uDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
    uPixel: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
  fragmentShader: /* glsl */ `
    #include <common>
    varying vec2 vUv;
    uniform sampler2D uAO;
    uniform vec2 uStep;
    ${VIEW}
    void main() {
      vec4 mid = texture2D( uAO, vUv );
      float z = -at( vUv ).z;
      vec3 n = mid.yzw * 2.0 - 1.0;
      float sum = mid.x, weight = 1.0;
      for ( int i = -2; i <= 2; i++ ) {
        if ( i == 0 ) continue;
        vec2 uv = vUv + float( i ) * uStep;
        vec4 s = texture2D( uAO, uv );
        float w = ( 1.0 - saturate( abs( -at( uv ).z - z ) / ( z * 0.035 ) ) ) * saturate( ( dot( s.yzw * 2.0 - 1.0, n ) - 0.7 ) * 3.333333 );
        sum += s.x * w; weight += w;
      }
      gl_FragColor = vec4( sum / weight, mid.yzw );
    }`,
  depthTest: false, depthWrite: false,
});

export function mapAO(): MapAO {
  const noise = new THREE.DataTexture(new Uint8Array(NOISE), 4, 4, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.needsUpdate = true;
  let depth: THREE.WebGLRenderTarget | null = null, a: THREE.WebGLRenderTarget | null = null, b: THREE.WebGLRenderTarget | null = null;
  const quad = new FullScreenQuad(occlusion);
  const full = new THREE.Vector2(), half = new THREE.Vector2();
  const view = (m: THREE.ShaderMaterial, camera: THREE.PerspectiveCamera) => {
    m.uniforms.uDepth.value = depth!.depthTexture;
    m.uniforms.uProj.value.copy(camera.projectionMatrix);
    m.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    m.uniforms.uPixel.value.set(1 / half.x, 1 / half.y);
  };
  return {
    draw(renderer, scene, camera) {
      renderer.getDrawingBufferSize(full);
      half.set(Math.max(1, Math.floor(full.x / 2)), Math.max(1, Math.floor(full.y / 2)));
      if (!depth || depth.width !== half.x || depth.height !== half.y) {
        depth?.dispose(); a?.dispose(); b?.dispose();
        depth = new THREE.WebGLRenderTarget(half.x, half.y, { depthTexture: new THREE.DepthTexture(half.x, half.y, THREE.FloatType) });
        const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
        a = new THREE.WebGLRenderTarget(half.x, half.y, opts);
        b = new THREE.WebGLRenderTarget(half.x, half.y, opts);
      }
      const was = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;
      // the map's depth: every material stops once its pixel is known to be there
      lit.uAOPass.value = 1;
      lit.uAOOn.value = 0;
      renderer.setRenderTarget(depth);
      renderer.render(scene, camera);
      lit.uAOPass.value = 0;
      view(occlusion, camera);
      occlusion.uniforms.uNoise.value = noise;
      quad.material = occlusion;
      renderer.setRenderTarget(a);
      quad.render(renderer);
      view(blur, camera);
      quad.material = blur;
      blur.uniforms.uAO.value = a!.texture;
      blur.uniforms.uStep.value.set(1 / full.x, 0);
      renderer.setRenderTarget(b);
      quad.render(renderer);
      blur.uniforms.uAO.value = b!.texture;
      blur.uniforms.uStep.value.set(0, 1 / full.y);
      renderer.setRenderTarget(a);
      quad.render(renderer);
      renderer.setRenderTarget(was);
      renderer.autoClear = autoClear;
      lit.uAO.value = a!.texture;
      lit.uAOPixel.value.set(1 / full.x, 1 / full.y);
      lit.uAOOn.value = 1;
    },
    dispose() {
      depth?.dispose(); a?.dispose(); b?.dispose(); noise.dispose(); quad.dispose();
      depth = a = b = null;
      lit.uAOOn.value = 0;
      lit.uAO.value = null;
    },
  };
}
