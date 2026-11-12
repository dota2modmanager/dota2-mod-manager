# Window themes

Right-click the hero mascot in the title bar. The menu has three entries:

- **Load a theme from a file…** puts a theme file on the window. It joins the round you click
  through on the mascot.
- **Save these colours as a theme…** writes the palette you wear now to a file. Edit that file to
  start a theme of your own. With your theme on, the entry saves your theme instead.
- **Remove your theme** drops it and goes back to the first hero.

## The file

```json
{
  "name": "Teal Night",
  "colors": {
    "primary": "#7ee0d0",
    "accent": "#4fd1bd",
    "on-primary": "#00332c",
    "primary-container": "#005046",
    "on-primary-container": "#c6fff4",
    "secondary": "#b3ccc6",
    "surface": "#0f1514",
    "surface-low": "#161d1c",
    "surface-container": "#1b2321",
    "surface-high": "#252d2b",
    "surface-highest": "#303836",
    "on-surface": "#dde4e2",
    "on-surface-variant": "#bec9c6",
    "outline": "#889390"
  },
  "background": "data:image/webp;base64,..."
}
```

The names are Material 3 roles, the same ones the built-in themes use
(`renderer/styles/themes.css`):

| Role | Where you see it |
|---|---|
| `primary`, `accent` | buttons, switches, the active tab, links |
| `on-primary` | text on a `primary` fill |
| `primary-container`, `on-primary-container` | muted accent blocks and their text |
| `secondary` | quieter accents |
| `surface` | the window's floor |
| `surface-low` … `surface-highest` | cards, panels and hovers, each a step above the last |
| `on-surface`, `on-surface-variant` | body text and the quieter text |
| `outline` | borders and dividers |

A theme sets all fourteen roles. It cannot change sizes, fonts, motion or the error colour.

`background` is optional: a PNG, JPEG or WebP image inside the file as a data URL, up to 3 MB. The
window shows it behind everything, under a veil of the `surface` colour.

## What the app refuses

The app checks a file before it applies it. It keeps the theme you had and tells you why when:

- a role is missing, a key is not one of the roles, or a value is not a colour like `#a1b2c3`;
- text would be hard to read. These pairs need WCAG contrast of 4.5 or more: `on-surface` on
  `surface` and on `surface-container`, `on-primary` on `primary`, and `on-primary-container` on
  `primary-container`. These need 3 or more: `on-surface-variant` on `surface` and `primary` on
  `surface`. Every built-in theme passes the same checks;
- the background is a link, an SVG, or larger than 3 MB.

The theme stays on your computer only. To share it, send the file.
