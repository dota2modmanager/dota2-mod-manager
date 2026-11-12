/* Effect thumbnails use the same native loadout simulation as the hero and recolor editor.
 * Jobs run sequentially and release their WebGL context when the frame has been captured. */
import * as THREE from 'three';
import type { Carrier } from './particles.ts';
import type { HeroScene } from './scene.ts';
import { effectCarrier } from './loadout-source.ts';
import { drawnBox } from './effect-frame.ts';

const W = 320;
const H = 180;
/** How long an effect runs on screen before its picture is taken, on top of the seconds the scene simulates to frame it. */
const RUN = 1;
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

/** The frame cut to what it drew and scaled to a card's picture: an effect fills the card however far it spread. */
function framed(canvas: HTMLCanvasElement): string | null {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  // on black, as the game draws them: an additive particle writes colour and hardly any alpha, so
  // a picture with an alpha channel would lose most of it
  const g = copy.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!g) return null;
  g.drawImage(canvas, 0, 0);
  const box = drawnBox(g.getImageData(0, 0, copy.width, copy.height).data, copy.width, copy.height);
  if (!box) return null;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const c = out.getContext('2d', { alpha: false });
  if (!c) return null;
  c.imageSmoothingQuality = 'high';
  c.drawImage(copy, box.x, box.y, box.w, box.h, 0, 0, W, H);
  return out.toDataURL('image/webp', 0.85);
}

async function draw(id: string): Promise<string | null> {
  const got = await window.api.preview3d.effect(id);
  if (!got) return null;
  const host=document.createElement('div');host.style.cssText=`position:fixed;left:0;top:0;width:${W*2}px;height:${H*2}px;opacity:0;pointer-events:none`;document.body.append(host);
  let scene:HeroScene|undefined;
  try {
    const {mountScene}=await import('./scene.ts');
    scene=await mountScene(host,effectCarrier(),[],{isolated:true,particles:[{part:-1,def:got.def}],sprites:got.sprites,resources:got.resources});
    await new Promise(resolve=>setTimeout(resolve,RUN*1000));
    scene.capture();
    const canvas=host.querySelector('canvas');
    return canvas?framed(canvas):null;
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
