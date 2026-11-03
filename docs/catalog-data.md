# The catalog as data

The site publishes the whole mod catalog as one JSON file:

```
https://dota2modmanager.com/catalog/data.json
```

The site's own catalog browser and search read it, and so can your bot, site or script. It is rebuilt with every deploy of the site, which follows the catalog: new mods show up within the hour or so it takes the catalog cron (`fingerprints.yml`) and the site build to run. Nothing about it needs a key or a header.

The file is compact on purpose (about 1500 mods in one request), so rows are arrays, not objects. [catalog-data.schema.json](catalog-data.schema.json) is the same description as a JSON Schema, and `site/test/catalog-data.test.mjs` checks every build against it.

## Top level

| Field | Type | What it is |
|---|---|---|
| `v` | number | Format version, `1`. A change that moves or removes a field bumps it; a new field at the end of a row does not. |
| `cats` | array of category rows | Every category, in the app's sidebar order. |
| `heroes` | array of hero rows | Every hero that has mods. |
| `mods` | array of mod rows | Every mod. A mod that comes in several styles is one row. |

## Category row

`[id, nameEn, nameRu, group]`

| # | Field | Example | Notes |
|---|---|---|---|
| 0 | `id` | `"terrains"` | The catalog's category id. |
| 1 | `nameEn` | `"Terrains"` | |
| 2 | `nameRu` | `"Ландшафты"` | |
| 3 | `group` | `"world"` | One of `heroes`, `world`, `effects`, `interface`, `sound`, `other`: the app's sidebar sections. |

## Hero row

`[slug, nameEn, nameRu, nicknames]`

| # | Field | Example | Notes |
|---|---|---|---|
| 0 | `slug` | `"invoker"` | The hero's page is `/heroes/<slug>/`. |
| 1 | `nameEn` | `"Invoker"` | |
| 2 | `nameRu` | `"Инвокер"` | Russian name where the site has one, else the English one. |
| 3 | `nicknames` | `"Инвок"` | What players type, joined with `\|`; `""` when there are none. |

## Mod row

`[key, name, cat, hero, img, author, date, styles, slots, authorUrl, authorPage, countKey]`

| # | Field | Type | Notes |
|---|---|---|---|
| 0 | `key` | string | Unique. The mod's page is `https://dota2modmanager.com/mods/<key>/`. |
| 1 | `name` | string | The name the catalog gives it. |
| 2 | `cat` | number | Index into `cats`. |
| 3 | `hero` | number | Index into `heroes`, or `-1` for a mod that is not about one hero. |
| 4 | `img` | string | Picture name, `""` for none. Full picture: `/mods/<img>.webp`; 400 px thumbnail: `/mods/t/<img>.webp`. |
| 5 | `author` | string | The author as the catalog credits them, `""` when unknown. |
| 6 | `date` | number | When the mod was added, in Unix seconds; `0` when unknown. |
| 7 | `styles` | string | Style names joined with `\|`, `""` for a mod with one look. |
| 8 | `slots` | array of strings | Item slots a hero mod replaces (`"weapon"`, `"head"`...), empty for the rest. |
| 9 | `authorUrl` | string | The author's own link from the catalog, `""` for none. |
| 10 | `authorPage` | string | Slug of the author's page on the site (`/authors/<slug>/`), `""` when they have none. |
| 11 | `countKey` | string | The download counter's key when it differs from `<category>/<name>`, else `""`. |

## Example

```json
["kunkka-saltworn-mariner", "Kunkka Saltworn Mariner", 2, 75, "kunkka-saltworn-mariner-i", "Harlord",
 1790294026, "I|II", ["misc", "shoulder"], "https://t.me/harlord_mods", "harlord",
 "hero-items/kunkka/Kunkka Saltworn Mariner"]
```

## Opening a mod in the app

A link `d2mm://mod/<category>/<name>[/<style>]`, each part URL-encoded, opens the mod's window in Dota 2 Mod Manager, and a preset link carries several mods at once. `src/deep-links.ts` and `src/preset-link.ts` in this repository are the reference for both formats.

## Credit

The mods, their pictures and their names belong to their authors and to the [Dota2PornFx](https://github.com/h6rd/Dota2PornFxWeb) catalog (GPL-3.0), which this file is built from. If you show them, name the catalog and the author of each mod, and link back to the mod's page or to the catalog.
