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
| 9 | States are not told by colour alone: switches say on or off (`role="switch"`, `aria-checked`), favourites say whether they are pressed (`aria-pressed`), and the open section and the picked category say they are the current one (`aria-current`) | Promise 2 and axe's ARIA rules; the scenario checks `aria-current` on every section and on the category it picks |
| 10 | Text over the translucent panels, gradients and pictures has the contrast WCAG asks for: 4.5:1, or 3:1 for large text | Measured on the pixels for every node axe cannot judge (`tools/sim/contrast.js`), on the same screens as promise 1 |
| 11 | What happens without the focus moving is said out loud: a mod installed, a pack finished, an error (WCAG 4.1.3) | Every toast is also announced through a live region, inside the open window when there is one, since `aria-modal` hides everything outside it (`renderer/ui/a11y.ts`, `announce`). The scenario installs a mod from its window and checks the words reach a region the reader can see |

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
- Nothing was ever said without the focus moving. The app had no live region at all, so
  "installed" and every error were toasts a screen reader never heard; and neither the open section
  nor the picked category was told, only underlined and highlighted. Found later the same day,
  writing the checklist for the person below, which is the argument for that pass.

## Contrast axe cannot judge

axe works contrast out from CSS. Behind a translucent panel, a gradient or a picture it cannot know
the colour, so it reports the text as "incomplete". In this app that was most of the text on screen.

The a11y scenario measures those nodes instead. It captures the window with every glyph's fill made
transparent, which leaves exactly what is behind the text. For each node it lays the text's colour
(its alpha times the opacity of everything it sits in) over each pixel under the text, and works out
the WCAG ratio. A node passes when the pixel at the 2nd percentile reaches the ratio; the worst pixel
goes in the report as well. Text that is disabled, scrolled out of sight, covered, or behind an open
window is left out, and the report says which and why. Every run writes `contrast-<screen>.json`
and the capture it measured, `contrast-<screen>.png`.

Measured on 2026-10-11, in a 1360x860 window on a 1920x1080 screen, default theme, after the
change below:

| Screen | Measured | Short of its ratio | Lowest that passes |
|---|---|---|---|
| Catalog | 64 | 0 | 4.78:1 |
| My mods | 19 | 0 | 7.81:1 |
| Presets | 20 | 0 | 7.81:1 |
| Settings | 36 | 0 | 7.81:1 |
| A mod's window | 5 | 0 | 9.33:1 |
| The remove question | 3 | 0 | 7.72:1 |

The first measurement found one thing short. The category under a card's name was `--text-faint`
at 62% of on-surface-variant; the cards are translucent and the page's gradient is lighter on the
right, so the same caption measured 4.53:1 on the first card of "Recently added" and 4.03:1 on the
fourth. The maintainer chose to raise the token to 70%, which changes 51 places in the app. The
caption now measures 4.78 to 5.53:1 on that screen and 4.73 to 5.33:1 at 125% on 1366x768, and any
text short of its ratio fails the run.

What the measurement does not cover: the seven hero themes other than the default, and text that
only appears on hover.

## Known gaps, kept on purpose

**The catalog is a long walk by Tab.** The maintainer went through every section with the keyboard
and a screen reader on 2026-10-15: everything could be reached and everything was read out. One
thing was slow. From the categories, Tab passes every one of them, about forty, before it reaches
the grid, and from the grid it passes every card of the category, hundreds in some, before it gets
back to them.

It stays that way. The people who run a Dota mod manager by keyboard alone or by ear are expected
to be few, it works as it is, and a skip link or a grid you move through with the arrow keys is
more to build and keep right than that slowness costs them. Two ways round it exist already: from
the first card, Shift+Tab is back among the categories in about a dozen presses (past the sort,
the filters and the first card's own buttons), and a screen reader can jump between the window's
landmarks (the categories are an `aside`, the grid is in `main`; D in NVDA) without passing the
cards in between.

## What no automated check covers

- **A screen reader pass by a person.** The tree is checked, the experience is not: whether the
  order things are announced in makes sense, whether an announcement comes at the right moment.
  [screen-reader-pass.md](screen-reader-pass.md) is the fifteen minutes it takes with NVDA or
  Narrator, once before a release that changes a screen, and where the results go.
- **Dragging.** The panel grips and the load order are dragged with a mouse. Each has a keyboard
  route that does the same job (the grips' fold buttons and Ctrl + / - / 0; the load order's
  move up and down), but not the drag itself.
