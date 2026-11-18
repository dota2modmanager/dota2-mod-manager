/* The stage a 3D preview draws on: a canvas and the patched dota-loadout viewer in it, kept from
 * one window to the next (scene.ts puts the scene in it). */
import { HeroViewer } from 'dota-loadout';
import { scrollIdle } from '../../ui/scroll-idle.ts';
import { loadoutControls } from './loadout-controls.ts';

/* One viewport outlives its window. A new WebGL context per window linked every shader again,
 * and the first frame of each hero stalled 150-200 ms each time a window opened (2026-11-15).
 * A closed window's viewport waits here with its hero parked (HeroViewer.park), and the next
 * window takes it: same context, most programs already made. One at most; a lost context is
 * let go rather than kept. */
let spare: SceneViewport | null = null;

/** A window owns one WebGL context while it is open; scene data can be replaced inside it. */
export function createSceneViewport(host: HTMLElement, label = '') {
  if (spare && !spare.lost()) {
    const kept = spare;
    spare = null;
    kept.adopt(host, label);
    return kept;
  }
  spare = null;
  return newSceneViewport(host, label);
}

function newSceneViewport(host: HTMLElement, label: string) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', label);
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  host.append(canvas);
  let home = host;
  const viewport = {
    afterUpdate: () => {},
    viewer: new HeroViewer(canvas, {
      assets: 'file:///unused-local-assets/', controls: true, wheel: 'zoom',
      framing: 'full', textureScale: 1, bloom: .35, softParticles: true,
      onFrame: dt => controls.tick(dt),
      onAfterUpdate: () => viewport.afterUpdate(),
      // a hero or an item shows once the list beside it has stopped moving (ui/scroll-idle.ts)
      beforeShow: () => scrollIdle(),
    }),
    canvas,
    /** into another window's stage, as it was */
    adopt(next: HTMLElement, nextLabel: string) {
      home = next;
      canvas.setAttribute('aria-label', nextLabel);
      next.append(canvas);
    },
    lost: () => viewport.viewer.renderer.getContext().isContextLost(),
    dispose() {
      home.style.removeProperty('--stage-tint');
      viewport.afterUpdate = () => {};
      if (!spare && !viewport.lost()) {
        viewport.viewer.park();
        canvas.remove();
        spare = viewport;
        return;
      }
      controls.dispose();
      viewport.viewer.dispose();
      canvas.remove();
    },
  };
  const controls = loadoutControls(viewport.viewer);
  return viewport;
}

export type SceneViewport = ReturnType<typeof newSceneViewport>;
