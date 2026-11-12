/* Where views/home.ts hands Home to React: one root in the pane the router gives it, drawn
 * synchronously inside paint() so a view transition captures it whole. */
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MotionConfig } from 'motion/react';
import { pane } from '../core/router.ts';
import { HomeScreen } from './HomeScreen.tsx';
import type { HomeModel } from './model.ts';
import type { HomeActions } from '../views/home.ts';

let root: Root | null = null;

export function showHome(m: HomeModel, a: HomeActions): void {
  root ||= createRoot(pane('home'));
  const r = root;
  flushSync(() => r.render(<MotionConfig reducedMotion="user"><HomeScreen m={m} a={a} /></MotionConfig>));
}
