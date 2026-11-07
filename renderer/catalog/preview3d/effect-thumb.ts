/* Effect thumbnails use the same native loadout simulation as the hero and recolor editor.
 * Jobs run sequentially and release their WebGL context when the frame has been captured. */
import * as THREE from 'three';
import type { Carrier } from './particles.ts';
import type { HeroScene } from './scene.ts';
import { effectCarrier } from './loadout-source.ts';

const W = 320;
const H = 180;
/** How long an effect runs before its picture is taken: long enough to fill out, short of a burst's end. */
const RUN = 2.5;
const kept = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

/** Source's axes and inches to the scene's: the same turn and scale a hero model's root has. */
const M = 0.0254;
export const SOURCE_AXES = new THREE.Matrix4().set(0, M, 0, 0, 0, 0, M, 0, M, 0, 0, 0, 0, 0, 0, 1);

/** Nothing to hang on: the effect sits at the point, and what spawns on a model spawns in a ball around it. */
export const EMPTY_CARRIER: Carrier = {
  bones: new Map(), attachments: [],
  surface: () => new THREE.Vector3().randomDirection().multiplyScalar(0.35 * Math.cbrt(Math.random())).add(new THREE.Vector3(0, 0.5, 0)),
};

/**
 * Whether a frame shows anything: many unusual effects take their colour from the courier that
 * wears them, which a picture has none of, and come out as a dark frame the glyph says more than.
 */
function lit(canvas: HTMLCanvasElement): boolean {
  const small = document.createElement('canvas');
  small.width = 32;
  small.height = 18;
  const g = small.getContext('2d', { willReadFrequently: true });
  if (!g) return true;
  g.drawImage(canvas, 0, 0, 32, 18);
  const px = g.getImageData(0, 0, 32, 18).data;
  let bright = 0;
  for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) > 50) bright++;
  return bright >= 4;
}

async function draw(id: string): Promise<string | null> {
  const got = await window.api.preview3d.effect(id);
  if (!got) return null;
  const host=document.createElement('div');host.style.cssText=`position:fixed;left:0;top:0;width:${W}px;height:${H}px;opacity:0;pointer-events:none`;document.body.append(host);
  let scene:HeroScene|undefined;
  try {
    const {mountScene}=await import('./scene.ts');
    scene=await mountScene(host,effectCarrier(),[],{isolated:true,particles:[{part:-1,def:got.def}],sprites:got.sprites,resources:got.resources});
    await new Promise(resolve=>setTimeout(resolve,RUN*1000));
    const image=scene.capture(),canvas=host.querySelector('canvas');
    return canvas&&lit(canvas)?image:null;
  } finally { scene?.dispose();host.remove(); }
}

/** An effect's picture as a data URI, or null where the game has no system for it or the window cannot draw. */
export function effectThumb(id: string): Promise<string | null> {
  let p = kept.get(id);
  if (!p) {
    p = queue.then(() => draw(id)).catch(() => null);
    queue = p;
    kept.set(id, p);
  }
  return p;
}
