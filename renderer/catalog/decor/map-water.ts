/* The river of the Optimization window's map as the game shows it rather than a flat sheet: the
 * game's water shader (water_dota.vfx) flows, catches the sun and shows the sky where it is seen
 * at a slant, and the riverbed through it. The light copy of the map keeps no water pictures (its
 * flow and noise maps are the game's shader's alone), so the waves here are made: a few moving
 * ripples bend the surface's normal, the sun's highlight runs soft on them, the sky's colour comes
 * in by the Fresnel term, and light caustics wander over it. Dota's river is clear, green-blue and
 * shallow: seen from above the riverbed shows through, and only at a slant does it turn to sky.
 * The first version was an opaque blue sheet with sharp glints, which is not how the game looks. */
import * as THREE from 'three';

/** The seconds the waves have run, shared by every water. */
export const waterTime = { value: 0 };

const vmatOf = (m: THREE.Material) => (m.userData as { vmat?: { ShaderName?: string } }).vmat;

/** Whether a material is the game's water. */
export const isWater = (m: THREE.Material): boolean => /water/i.test(String(vmatOf(m)?.ShaderName ?? ''));

const made = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();

/** The water material that draws in place of the export's flat one (one per original). */
export function waterOf(original: THREE.Material): THREE.MeshStandardMaterial {
  const had = made.get(original);
  if (had) return had;
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.03, 0.15, 0.16),
    roughness: 0.32,
    metalness: 0,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  m.userData = { ...original.userData };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = waterTime;
    sh.uniforms.uSky = { value: new THREE.Color(0.55, 0.68, 0.82) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uSky;\nvarying vec3 vWaterPos;')
      // ripples of three sizes running different ways bend the surface the light sees
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec2 wp = vWaterPos.xz;
        float t = uTime;
        vec3 wn = vec3(
          sin(wp.x * 0.85 + t * 1.2) * 0.035 + sin(wp.y * 1.6 - t * 0.9) * 0.025 + sin((wp.x + wp.y) * 3.3 + t * 2.3) * 0.015,
          1.0,
          cos(wp.y * 1.05 + t * 1.0) * 0.035 + cos(wp.x * 1.9 - t * 1.5) * 0.025 + cos((wp.x - wp.y) * 3.7 + t * 1.9) * 0.015);
        normal = normalize((viewMatrix * vec4(normalize(wn), 0.0)).xyz);`)
      // the sky in the water where it is seen at a slant, more opaque there as real water is
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
        // caustics: two moving cell patterns, bright where they meet, as light on a shallow bed
        vec2 cp = wp * 1.4;
        float ca = abs(sin(cp.x + sin(cp.y * 1.3 + t * 0.8)) * sin(cp.y + sin(cp.x * 1.1 - t * 0.7)));
        float cb = abs(sin(cp.x * 1.7 - t * 0.5 + sin(cp.y * 0.9)) * sin(cp.y * 1.5 + t * 0.6));
        float caustic = smoothstep(0.55, 1.0, max(ca, cb)) * 0.06;
        gl_FragColor.rgb += vec3(0.75, 0.95, 0.9) * caustic;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, fres * 0.55);
        gl_FragColor.a = mix(gl_FragColor.a + caustic, 0.92, fres);`);
  };
  m.customProgramCacheKey = () => 'map-water';
  made.set(original, m);
  return m;
}
