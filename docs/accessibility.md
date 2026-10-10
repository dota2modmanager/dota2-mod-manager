# Accessibility

What the app promises to someone who does not use a mouse, or who listens to it rather than
looks at it, and how each promise is checked. The list is finite on purpose: a promise is on it
when there is a check behind it, and the last section says what no automated check can cover.

## The promises

| # | Promise | Checked by |
|---|---|---|
| 1 | Every section and every window passes axe-core against WCAG 2.0, 2.1 and 2.2, level A and AA | `tools/sim/scenarios/a11y.js`, on the catalog, My mods, Presets, Settings, a mod's window and the remove question |
| 2 | Every control a screen reader meets has a role and a name, and no name is an icon's ligature ("check_circle") | The same scenario reads Chromium's accessibility tree over the DevTools protocol, the tree a screen reader reads |
| 3 | Tab goes everywhere a mouse can, never lands on nothing, and every stop is on screen with a visible ring | A walk of 120 Tab presses from the section tabs, sent as real key events; the ring is the one every control gets (`renderer/styles/tokens.css`) |
| 4 | A mod can be found, opened, installed and removed with the keyboard alone | The scenario does exactly that with Tab, Enter and Escape: open a card, install from its window, remove it from My mods |
| 5 | A window that opens over the app takes the focus, keeps it while open (Tab and Shift+Tab go round inside it), and gives it back to what opened it when it closes | Checked on a mod's window and on the remove question; done for every window in one place, `renderer/ui/a11y.ts` |
| 6 | Escape closes a window and answers a question with no | The remove question: Escape, and the mod is still there |
| 7 | A destructive question says what it will remove | The remove question names the mod; the window e2e checks the same with the mouse |
| 8 | Nothing sticks out of the window or scrolls sideways at the scales the app offers | `tools/sim/scenarios/settings.js` at 110%, and every simulator screen profile, up to 125% on 1366x768 |
| 9 | States are not told by colour alone: switches say on or off (`role="switch"`, `aria-checked`), favourites say whether they are pressed (`aria-pressed`) | Promise 2 and axe's ARIA rules |

The scenario runs in the simulator on every pull request, on Windows and on Linux
(`.github/workflows/sim.yml`), next to the other scenarios.

## What was wrong when this list was first checked (2026-10-11)

- A card in the catalog could not be opened from the keyboard, so nothing could be installed
  without a mouse. The card's box took the click; only its star and its plus took the focus. The
  name is now a button that looks exactly like the text it was (`renderer/catalog/card/CardName.tsx`).
- Tab walked out of a mod's window into the grid behind it, and closing a window left the focus on
  nothing.
- The sort, hero, group and slot lists, and the language list, had no name.
- Icons read out as their ligature: "check_circle Installed", "chevron_left".
- The panel grips claimed `role="separator"` with a button inside, which a separator may not hold.
- The simulator pressed Enter without the character Chromium presses a button on, so a test of
  "Enter opens it" could not have passed whatever the app did (`tools/sim/driver.js`).

## What no automated check covers

- **Contrast over the translucent panels.** axe reports these as "incomplete": it cannot see the
  colour behind a semi-transparent surface. Each run writes them to `axe-<section>.json` beside its
  pictures for a person to look at.
- **A screen reader pass by a person.** The tree is checked, the experience is not: whether the
  order things are announced in makes sense, whether a progress toast is heard. NVDA or Narrator
  over the four sections, a mod window and the install queue, once before a release that changes
  a screen.
- **Dragging.** The panel grips and the load order are dragged with a mouse. Each has a keyboard
  route that does the same job (the grips' fold buttons and Ctrl + / - / 0; the load order's
  move up and down), but not the drag itself.
