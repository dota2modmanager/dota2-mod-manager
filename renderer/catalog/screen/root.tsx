/* Where views/catalog.js hands its screen to React. One root for the life of the window, so a
 * filter flipped on the same category updates the cards on show instead of throwing them away;
 * a new category is a new key (model.ts), and draws fresh. Drawn inside the caller's paint(),
 * synchronously, so a view transition captures the new screen whole. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MotionConfig } from 'motion/react';
import { Screen } from './Screen.tsx';
import type { ScreenActions, ScreenModel } from './model.ts';
import { screenLayer, whenScreenLeaves } from '../layers.ts';

const root = createRoot(screenLayer());
let last: { model: ScreenModel; actions: ScreenActions } | null = null;

function draw(model: ScreenModel, actions: ScreenActions): void {
  last = { model, actions };
  flushSync(() => root.render(<MotionConfig reducedMotion="user"><Screen model={model} actions={actions} /></MotionConfig>));
}

export function showScreen(model: ScreenModel, actions: ScreenActions): void {
  screenLayer();
  draw(model, actions);
}

/** The screen on show, drawn again from what it was last given: installs changed a badge. */
export function redrawScreen(): void {
  if (last) draw(last.model, last.actions);
}

// a legacy screen took the pane (a cosmetic slot, the item builder): draw nothing meanwhile
whenScreenLeaves(() => {
  if (last) draw({ kind: 'none' }, last.actions);
});
