# Sharing a mod

## Credits in the VPK

Put a text file in the VPK's root, such as `<mod>_by_<author>.txt`:

```
Necrophos "Scream" by TheFleece
https://github.com/dota2modmanager/dota2-mod-manager

Telephone: "Western Electric 500" by Skyice, https://sketchfab.com/..., CC BY 4.0. Decimated, rigged, retextured.
Pedestal: "Antique Wooden Pedestal Stand Type A" by Mad_Lobster_Workshop, https://sketchfab.com/..., CC BY 4.0. Decimated.
Sounds: telephone ring from Pixabay (Pixabay licence).
```

`modkit pack` packs everything in the folder you give it, so drop the file at the folder's top.

## Licences

- **Models from Sketchfab and elsewhere:** check each model's licence before using it. CC BY needs
  the author's name, a link, the licence and what you changed. CC BY-NC forbids selling. Without a
  licence that allows it, do not ship the model.
- **Sounds:** your recordings and synthesis are yours. Sound libraries have their own terms. A
  line from a film is not yours to share.
- **Characters and logos are trademarks.** A mask that copies a film character can get a shared
  mod taken down. Make your own version, or keep the mod for yourself.
- **Valve's files:** a mod ships modified copies of Valve's game files for use with Dota 2. Do
  not sell mods.
- Ask the user before publishing anything with third-party material, and say which licences apply.

## Hidden signatures

A faint signature in your colour maps (a few levels darker on light areas) marks your work without
showing in the game. It survives in the PNG sources; texture compression may blur it.

## Before you share

1. `npm run doctor -- <mod>.vpk` clean.
2. The bench in a match or the user's own game check.
3. A 1280x720 catalog picture ([ui-pictures.md](ui-pictures.md)).
4. A short list of what the mod changes, and which other mods it conflicts with (two mods that
   replace the same file cannot both win; the minimap sheet is one file for all heroes).

## Where

- **Dota 2 Mod Manager users** install a VPK by dragging it onto the app (My mods). Send the file.
- **The catalog** the app installs from is D2PFX, an open community catalog
  (https://dota2modmanager.com/docs/catalog/). It takes submissions through its Discord, linked on
  that page. Once a mod is in D2PFX, the app and https://dota2modmanager.com/catalog/ show it.
- **Never** ask people to drop files into the game folder by hand: the app picks a free slot,
  keeps the mod across patches and turns it off in one click.
