# catalog-data

What the catalog job (`.github/workflows/fingerprints.yml` on `main`) writes, and nothing else:

- `fingerprints.json`, which the app reads to recognise a mod it did not install;
- `hero-index.json`, which heroes each catalog mod is about;
- `site/src/data/heroes.json`, `site/src/data/categories.json` and `site/public/mods/`, the hero
  and category pages of the site and the previews they show.

The job checks the catalog every 30 minutes and commits here when it changed. This branch holds
data and no code, so its commits do not go through the pull requests and checks that `main`
requires. The app reads `fingerprints.json` from here, and the site build copies the rest in
before it builds.

The paths are the ones these files had on `main`, so a file can be compared across the two.
