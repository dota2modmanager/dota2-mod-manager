/* What the hero in the 3D preview is doing: the clip it stands in, and any other the window asks
 * for, out of the two the model came with or the file of all its clips, fetched the first time.
 * A motion with an end plays once and hands the hero back to the one it stands in. */
import * as THREE from 'three';

/** Play a clip by name, or the one the hero stands in; `onEnd` given, once. False when it has no such clip. */
export type PlayMotion = (name: string | null, motions?: () => Promise<Uint8Array | null>, onEnd?: () => void) => Promise<boolean>;

/**
 * @param own    the clips the model came with
 * @param stand  the name of the one the hero stands in, else its idle, else its first
 * @param read   the clips out of a file of them
 */
export function motionPlayer(mixer: THREE.AnimationMixer, own: THREE.AnimationClip[], stand: string | null, read: (bytes: Uint8Array) => Promise<THREE.AnimationClip[]>) {
  const home = own.find((a) => a.name === stand) || own.find((a) => /idle/i.test(a.name)) || own[0];
  let action = home ? mixer.clipAction(home).play() : null;
  let others: THREE.AnimationClip[] | null = null;
  let ended: (() => void) | null = null;

  const finished = (e: { action: THREE.AnimationAction }) => {
    if (e.action !== action || !home) return;
    const was = action;
    action = mixer.clipAction(home);
    action.setLoop(THREE.LoopRepeat, Infinity).reset().play();
    was.crossFadeTo(action, 0.25, false);
    ended?.();
    ended = null;
  };
  mixer.addEventListener('finished', finished);

  const play: PlayMotion = async (name, motions, onEnd) => {
    if (name && !own.some((a) => a.name === name) && !others && motions) {
      const bytes = await motions();
      if (bytes) others = await read(bytes);
    }
    const next = !name ? home : own.find((a) => a.name === name) || others?.find((a) => a.name === name);
    if (!next) return false;
    const was = action;
    action = mixer.clipAction(next);
    ended = onEnd || null;
    action.setLoop(onEnd ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = !!onEnd;
    if (was !== action || onEnd) {
      action.reset().play();
      if (was && was !== action) was.crossFadeTo(action, 0.2, false);
    }
    return true;
  };

  return { play, home, dispose: () => mixer.removeEventListener('finished', finished) };
}
