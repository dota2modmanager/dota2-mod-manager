# The screen reader pass

The simulator checks the accessibility tree on every change ([accessibility.md](accessibility.md)):
every control has a role and a name, Tab reaches everything, windows hold and return the focus. It
cannot tell whether the app makes sense when you listen to it. This page is the fifteen minutes a
person spends finding out, with NVDA or Narrator, before a release that changes a screen.

Run it against the sandbox so nothing touches your game: `npm run sandbox:seed`, then
`npm run start:sandbox`. Turn the reader on (Narrator: Ctrl+Win+Enter; NVDA: Ctrl+Alt+N) and put
the mouse away.

## The tasks

Each one has what you should hear. Anything different goes in the results below, even when it
was only odd.

1. **Find your way around.** From the section tabs, Tab once at a time through the title bar.
   You hear the four sections by name (Catalog, My mods, Presets, Settings), the open one as the
   current page, then Help, the search field by its name, Sign in, and the window buttons. No icon names
   ("apps", "favorite", "chevron_left") anywhere.
2. **Pick a category.** Keep tabbing into the category list and press Enter on one. Each
   category is read by its name alone, and the one you picked as current.
3. **Open a mod.** Tab into the grid and press Enter on a card's name. The mod's window opens and
   the reader starts inside it with the mod's name. Tab goes round inside the window and never
   back out to the grid.
4. **Install it.** Tab to Install and press Enter. When it finishes you hear "<the mod> installed"
   without moving the focus to find out. Escape closes the window and puts you back on the card
   you opened it from.
5. **Remove it.** Go to My mods, Tab to the mod's row and its Remove button, press Enter. The
   question names the mod. Escape answers no and the mod stays; the focus is back on Remove.
6. **Change a setting.** In Settings, Tab to a switch and press Space. You hear the switch's name
   and that it is now on, or off.

## Results

| Date | App version | Reader | Tasks that went as written | What was different |
|---|---|---|---|---|
| | | | | |

A finding becomes an issue, and a task above changes when the app changes what you should hear.
