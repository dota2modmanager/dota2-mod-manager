/* The sections visited, for the mouse's back and forward buttons and Alt+Left/Right.
 * People asked for them on Discord: a browser has taught every hand to go back that way.
 * Pure, so the router keeps one and the tests drive another. */

const LIMIT = 50;

export interface ViewHistory {
  /** a section was opened by a click or a key, not by going back or forward */
  visit(view: string): void;
  /** the section to go back to, moving the cursor; null at the start */
  back(): string | null;
  /** the section to go forward to, moving the cursor; null at the end */
  forward(): string | null;
}

export function createViewHistory(first: string): ViewHistory {
  let list = [first];
  let at = 0;
  return {
    visit(view) {
      if (list[at] === view) return;
      // a new visit after going back drops the way forward, as a browser does
      list = list.slice(0, at + 1);
      list.push(view);
      if (list.length > LIMIT) list = list.slice(list.length - LIMIT);
      at = list.length - 1;
    },
    back() {
      if (at === 0) return null;
      at -= 1;
      return list[at];
    },
    forward() {
      if (at >= list.length - 1) return null;
      at += 1;
      return list[at];
    },
  };
}
