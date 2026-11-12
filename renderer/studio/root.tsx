/* Where views/studio.ts hands the Workshop to React: one root in the pane the router gives it,
 * drawn synchronously inside paint() so a view transition captures it whole. */
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MotionConfig } from 'motion/react';
import { StudioScreen, type StudioGroup, type StudioTile } from './StudioScreen.tsx';

let root: Root | null = null;

export function showStudio(el: HTMLElement, groups: StudioGroup[], onOpen: (t: StudioTile, el: HTMLElement) => void): void {
  root ||= createRoot(el);
  const r = root;
  flushSync(() => r.render(<MotionConfig reducedMotion="user"><StudioScreen groups={groups} onOpen={onOpen} /></MotionConfig>));
}
