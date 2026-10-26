/**
 * Ten more guides, in both languages.
 *
 * A separate file from docs.ts for length alone: the two together are one table of pages, and
 * merging happens there. The rule is the same one that file states - both languages side by
 * side, so a paragraph that exists in one and not the other is visible while typing.
 *
 * Why these. The five originals answer how modding works; these answer what people
 * actually type. Terrains are the most-wanted mod in Dota and every guide ranking for them
 * teaches the `-language tempcontent` trick that stopped producing a folder on 2026-07-24.
 * Removing mods is the second thing searched after installing them and nothing here answered
 * it. The language folder is the piece no other guide explains correctly, and it is the reason
 * the terrain guides broke. Announcers, and your own files, had no page at all. The last two
 * are about the people this is built on and about choosing between the tools in this corner:
 * both get asked, and until now both got answered by somebody else. The copies page came in
 * October 2026, once renamed copies of this app with no source, no credit and sometimes a price
 * or a required login had turned up in more than one place: a person who meets one of those first
 * needs a page that says how to tell, and so does an assistant asked which launcher to trust.
 *
 * Facts are read off the code they describe: pak slots and priority categories from
 * installer.js (PRIORITY_CATEGORIES, allocatePak), the folder name from gamelang.js, the
 * search-path patch from patcher.js. Claims about other people's software are limited to what
 * their own site or repository states, and said as theirs.
 *
 * Counts written as {mods} or {categories} are filled by the layout at build time.
 */
import type { Doc } from './docs.ts';

type Slug = 'uninstall' | 'terrain' | 'announcer' | 'language' | 'own-mods' | 'ai-mods' | 'catalog' | 'minify' | 'compare' | 'copies';

/*
 * The ai-mods page (October 2026) describes skills/dota2-modding in the repo: the skill an AI
 * assistant reads to make a mod, written down while building the "Scream" Necrophos set. The
 * one-line setup points at /ai/setup.md, which serves that folder's SETUP.md (src/pages/ai/).
 * What the skill can do is what its references cover; if a reference goes, so does its line here.
 */
const SETUP_PROMPT = 'Set up Dota 2 modding for me: https://dota2modmanager.com/ai/setup.md';
const SETUP_PROMPT_RU = 'Настрой мне моддинг Доты 2: https://dota2modmanager.com/ai/setup.md';
const PLUGIN_ADD = '/plugin marketplace add dota2modmanager/dota2-mod-manager';
const PLUGIN_INSTALL = '/plugin install dota2-modding@dota2modmanager';

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

const en: Record<Slug, Doc> = {
  uninstall: {
    slug: 'uninstall',
    title: 'How to remove Dota 2 mods and undo everything',
    h1: 'How to remove Dota 2 mods',
    description:
      'Take one mod off, switch all of them off for a single game, or put Dota back exactly as Valve ships it. With the app and by hand, including fonts, cursors and the schema patch.',
    lead: 'Three different things get called removing a mod: taking one off, turning everything off for one game, and leaving no trace at all. Here are all three, and what happens to the files in each.',
    card: 'One mod, every mod at once, or a full return to a clean game. Fonts, cursors and the patch included.',
    blocks: [
      { k: 'h2', t: 'Take one mod off', id: 'one' },
      {
        k: 'steps',
        items: [
          ['Open My mods', 'Everything installed, with a switch next to each one.'],
          ['Press Delete', 'The file leaves the game folder and the entry leaves your library. The game goes back to how it was before that mod.'],
          ['Restart Dota', 'The game reads its archives when it starts, so a client already running will not notice.'],
        ],
      },

      { k: 'h2', t: 'Switching off is not deleting', id: 'off' },
      {
        k: 'p',
        t: 'If you want the mod back tomorrow, do not delete it. The switch next to a mod renames its file and leaves the entry in your library, and one click brings it back. A second switch turns every mod off at once, which is what you want before a tournament game or straight after a patch when you do not yet know what broke.',
      },

      { k: 'h2', t: 'By hand, without the app', id: 'manual' },
      {
        k: 'p',
        t: 'A mod is a file called pakNN_dir.vpk sitting in the language folder the game mounts. Delete the file and the mod is gone.',
      },
      {
        k: 'steps',
        items: [
          [
            'Open the language folder',
            'Inside <code>...\\steamapps\\common\\dota 2 beta\\game\\</code>, named after your voice language rather than your text one: <code>dota_russian</code>, <code>dota_koreana</code> or <code>dota_schinese</code>. <a href="~/docs/language/">Which folder is yours</a>.',
          ],
          ['Look at the pak numbers', 'Mods are pak02_dir.vpk through pak99_dir.vpk. Every file in the folder that is not pak01 arrived from outside the game.'],
          ['Delete the ones you want gone', 'Gaps in the numbering are fine. The game does not care whether pak04 exists when pak05 does.'],
        ],
      },
      {
        k: 'note',
        t: 'Never delete <code>pak01_dir.vpk</code> or the <code>pak01_NNN.vpk</code> files next to it. Those are the game\'s own, and deleting them means a repair through Steam.',
      },

      { k: 'h2', t: 'Fonts and cursors', id: 'fonts' },
      {
        k: 'p',
        t: 'These two replace files instead of layering over them, so the app copies the originals before installing and puts them back when you remove the mod. If you installed a font by hand and kept no copy, Steam\'s file verification returns it.',
      },

      { k: 'h2', t: 'Back to a clean game', id: 'reset' },
      {
        k: 'list',
        items: [
          'Switch safe mode back on, which takes the looks off the default items. The app restores <code>gameinfo_branchspecific.gi</code> and <code>dota.signatures</code> from the copies it made before the first write.',
          'Delete everything in My mods.',
          'If you ever installed anything by hand, look in the language folder for pakNN_dir.vpk files still sitting there.',
          'In Steam, open the game properties, then Installed Files, then verify integrity. That returns everything that belongs to Valve.',
          'The app itself uninstalls the ordinary way, through Installed apps in Windows.',
        ],
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Does removing a mod remove cosmetics from my inventory?', 'No. Nothing here touches your Steam account, and your inventory is untouched either way.'],
          [
            'Will verifying files in Steam remove my mods?',
            'It restores files that belong to the game. Extra pakNN_dir.vpk files in the language folder are usually left alone, so if the point is to get rid of mods, delete those yourself.',
          ],
          [
            'I removed a mod and the game still shows it.',
            'Restart the game completely: archives are read at startup. If it survives that, a second mod is probably carrying the same files. <a href="~/docs/vpk/">How the game picks a winner</a>.',
          ],
        ],
      },
    ],
  },

  terrain: {
    slug: 'terrain',
    title: 'How to install a Dota 2 terrain in 2026',
    h1: 'Terrains: installing a custom map in Dota 2',
    description:
      'Installing a Dota 2 terrain with the app or by hand, why every guide teaching -language tempcontent stopped working in July 2026, and how trees and the river fit around it.',
    lead: 'A terrain is the most visible mod in Dota and the usual reason somebody starts modding at all. Every guide on the first page of search results teaches a trick that stopped working on 24 July 2026.',
    card: 'Terrains, trees and the river. Why -language tempcontent died and how a terrain is installed now.',
    blocks: [
      { k: 'h2', t: 'What a terrain actually is', id: 'what' },
      {
        k: 'p',
        t: 'A terrain replaces the map: the ground, the cliffs, the trees, the river, the ambient effects. Technically it is an ordinary mod, a VPK archive of models and textures laid over the game\'s own. Terrains, trees and the river are separate categories in the catalog because people mix them, taking the ground from one and the trees from another.',
      },

      { k: 'h2', t: 'Why the old guides stopped working', id: 'broken' },
      {
        k: 'p',
        t: 'Almost every terrain guide teaches the same move: add <code>-language tempcontent</code> to the launch options and drop the mod in a folder called <code>dota_tempcontent</code>. On 24 July 2026 Dota stopped taking the language from that argument. Both languages now live in <code>game/dota/cfg/boot.vcfg</code>, and the engine substitutes the audio language into its search path. A made-up value like tempcontent no longer creates a folder or mounts one, so the mod simply never loads.',
      },
      {
        k: 'p',
        t: 'The argument itself still exists and still sets the language. What it can no longer do is invent a folder out of a value nothing recognises. <a href="~/docs/language/">The whole story of the language folder</a>.',
      },

      { k: 'h2', t: 'With the app', id: 'app' },
      {
        k: 'steps',
        items: [
          ['Open Terrains in the catalog', 'Every terrain has a preview, so you see what you are getting before it is on your disk.'],
          ['Press Install', 'The app downloads it, puts it in a free pak slot in the folder your game actually mounts, and remembers what it wrote.'],
          ['Restart Dota', 'A running client will not pick it up. Close it fully first.'],
        ],
      },
      {
        k: 'p',
        t: 'Trees, the river and shaders go into lower-numbered slots than the terrain itself, because a lower number wins when two mods carry the same file. That is what lets you run one author\'s ground under another author\'s trees.',
      },

      { k: 'h2', t: 'By hand', id: 'manual' },
      {
        k: 'steps',
        items: [
          ['Find your language folder', 'Named after your voice language, not your text one. <a href="~/docs/language/">How to tell which</a>.'],
          ['Rename the file', 'To a free pakNN_dir.vpk, where NN is anything from 02 to 99 that is not taken. Never 01.'],
          ['Drop it in and restart', 'That is the whole mechanism. No launch options, no edits to game files.'],
        ],
      },

      { k: 'h2', t: 'A terrain, trees and a river together', id: 'combo' },
      {
        k: 'p',
        t: 'These three overlap. A terrain that ships its own trees and a separate tree mod both carry the same files, and only one of them can win: the one in the lower pak slot. The app tells you which and lets you drag them into another order. Installed by hand, you discover it by looking at the map.',
      },

      { k: 'h2', t: 'What breaks a terrain', id: 'breaks' },
      {
        k: 'list',
        items: [
          'A game patch overwrote the files the mod depends on. Common, and it is what the repair step exists for.',
          'Two terrains installed at once. One of them is doing nothing.',
          'The mod is in a folder the game does not mount, which is what the old guides caused.',
          'An old <code>dota_tempcontent</code> folder left over from those guides, still holding the mods you think are installed.',
        ],
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Are terrains free?', 'The ones in the catalog are. Valve sells terrains too, and a mod does not replace one: it changes what you see, not what your account owns.'],
          ['Can other players see my terrain?', 'No. It is drawn by your client, on your screen. Everyone else sees the map they installed.'],
          ['How many terrains can I have installed?', 'As many as you like, but one of them is doing the work. Switch the rest off rather than leaving them to argue.'],
          ['Does a terrain affect performance?', 'It can, in both directions. Some are heavier than Valve\'s, and the catalog\'s optimization category exists to go the other way.'],
        ],
      },
    ],
  },

  announcer: {
    slug: 'announcer',
    title: 'How to change the announcer in Dota 2',
    h1: 'Announcers and voices in Dota 2',
    description:
      'Two ways to change your Dota 2 announcer: a voice mod from the catalog, or one your account already owns. Plus mega-kill packs, hero voices and why the folder matters.',
    lead: 'The announcer changes by two different routes, and they are not the same thing. One installs somebody else\'s recording as a file. The other switches on what you already own.',
    card: 'A voice mod or an announcer from your inventory. Mega-kills, hero voices and why a restart is needed.',
    blocks: [
      { k: 'h2', t: 'Two different things', id: 'two' },
      {
        k: 'cards',
        items: [
          [
            'A voice mod',
            'Somebody recorded a set of lines and packed them as a VPK. It replaces what you hear regardless of what your account owns, and it is a file in the game folder like any other mod.',
          ],
          [
            'An announcer you already own',
            'Announcers you have from bundles, battle passes or drops sit unused because the client only shows what it thinks you have equipped. That is a list, not a file, and it can be corrected locally. <a href="~/docs/cosmetics/">How the item table works</a>.',
          ],
        ],
      },

      { k: 'h2', t: 'Installing a voice mod', id: 'mod' },
      {
        k: 'steps',
        items: [
          ['Open Announcers in the catalog', 'Most have a preview you can listen to before installing.'],
          ['Press Install', 'The app puts it in a free pak slot in the folder the game mounts.'],
          ['Restart Dota', 'Sound is loaded at startup like everything else.'],
        ],
      },
      {
        k: 'note',
        t: 'Voice lines live in the folder named after your <b>audio</b> language, not your interface language. Changing the audio language in Dota\'s settings moves the game to a different folder and leaves your voice mods behind in the old one. <a href="~/docs/language/">Why that happens</a>.',
      },

      { k: 'h2', t: 'Mega-kills and hero voices', id: 'mega' },
      {
        k: 'p',
        t: 'Mega-kill packs and hero voice packs work the same way and live in their own catalog categories. They collide with an announcer mod only when both carry the same lines, which the app tells you about.',
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Do other players hear my announcer?', 'No. Everyone hears whatever they have equipped themselves.'],
          [
            'The mod installed and nothing changed.',
            'Two usual causes: the game was not fully restarted, or the mod went into a language folder your game is not mounting. <a href="~/docs/troubleshooting/">More symptoms</a>.',
          ],
          ['Can I mix an announcer with a mega-kill pack?', 'Yes, as long as they are not carrying the same files. The app says when they are.'],
        ],
      },
    ],
  },

  language: {
    slug: 'language',
    title: 'The dota_english folder and why -language mods fails',
    h1: 'The language folder: where mods actually go',
    description:
      'Which folder Dota 2 mounts after the July 2026 update: UILanguage and AudioLanguage in boot.vcfg, why dota_tempcontent is no longer created, and how to find your own folder.',
    lead: 'Every mod for Dota lives in a folder named after a language. Which one is decided by the game\'s own settings file, not by a launch option, and that changed on 24 July 2026.',
    card: 'boot.vcfg, UILanguage against AudioLanguage, and why a made-up folder no longer mounts.',
    blocks: [
      { k: 'h2', t: 'Where the folder name comes from', id: 'name' },
      {
        k: 'p',
        t: 'Dota\'s search paths include an entry with a placeholder for the language, and the engine substitutes a real value into it at startup. Whatever that value is, the folder <code>game/dota_&lt;value&gt;</code> gets mounted and everything inside it loads on top of the game\'s own archives. That is the whole mechanism mods run on. Nothing is patched and nothing is injected: a folder the engine already looks in gets an extra archive in it.',
      },

      { k: 'h2', t: 'Two languages, not one', id: 'two' },
      {
        k: 'p',
        t: 'The July 2026 update split the setting in two and moved both into <code>game/dota/cfg/boot.vcfg</code>:',
      },
      { k: 'code', t: '"boot"\n{\n\t"UILanguage"    "english"\n\t"AudioLanguage" "english"\n}' },
      {
        k: 'p',
        t: 'The one that matters here is <b>AudioLanguage</b>. That is the value the engine puts into the search path, which is why switching your voice language asks for a restart and switching interface text does not. Interface text lives in the game\'s own pak01 for every language at once, so it never had a folder of its own.',
      },

      { k: 'h2', t: 'Why -language mods stopped working', id: 'dead' },
      {
        k: 'p',
        t: 'The old trick relied on the argument being free-form. You passed <code>-language mods</code> or <code>-language tempcontent</code>, the engine put that word into the search path, and a folder appeared for you to hide mods in, away from the real language folders. Now a word Dota does not recognise as a language produces nothing. The folder is not created, not mounted, and the mods in it never load.',
      },
      {
        k: 'p',
        t: 'The argument still works and still sets the language. It just cannot invent a folder any more. Every guide still teaching that step is sending people to a directory the game will never open, which is the single most common reason a mod installed correctly does nothing.',
      },

      { k: 'h2', t: 'What a launch option does to all of this', id: 'launch' },
      {
        k: 'p',
        t: 'A <code>-language</code> in Steam\'s launch options outranks the setting in boot.vcfg. Measured, not assumed: on a machine with <code>-language dutch</code> set and <code>AudioLanguage russian</code> written in boot.vcfg, the game mounted <code>dota_dutch</code> and never opened <code>dota_russian</code> at all. The console log lists what was mounted, and Russian did not appear in it.',
      },
      {
        k: 'p',
        t: 'So the order is: a <code>-language</code> naming a real Dota language wins outright; failing that, AudioLanguage from boot.vcfg decides; and a <code>-language</code> naming something Dota does not know decides nothing at all, because the engine mounts no folder for it. The parameter also locks both language settings while it is there, which is why the text language stops being changeable in game.',
      },
      {
        k: 'note',
        t: 'This is what other mod tools use: set a language nobody plays in, fill the folder it names, and hand back the English text as an archive. It works, and it is why a mod installed into the folder your voice language names can still do nothing. The app reads the launch option and installs into whatever folder the game is really going to mount.',
      },

      { k: 'h2', t: 'Finding your folder', id: 'find' },
      {
        k: 'steps',
        items: [
          ['Open the game folder', 'Steam, right-click Dota 2, Manage, Browse local files, then into <code>game</code>.'],
          ['Check the launch options first', 'Steam, right-click Dota 2, Properties. A <code>-language something</code> there decides everything, and the folder is <code>dota_something</code>.'],
          ['No launch option? Read boot.vcfg', 'A text file in <code>game/dota/cfg/</code>. AudioLanguage is your answer, and the folder is the one that matches it.'],
        ],
      },
      {
        k: 'note',
        t: 'No <code>dota_</code> folder at all? Your audio language is English, and Valve ships no folder for it: English speech sits inside the base game. You cannot create the folder yourself either, and switching the audio language to Russian, Korean or Chinese does not cost you English voices. <a href="~/docs/install/#english">The whole case, and why</a>.',
      },
      {
        k: 'p',
        t: 'The app does this for you and shows the folder it is writing to, which is worth a glance the first time you install anything.',
      },

      { k: 'h2', t: 'If you change your voice language', id: 'switch' },
      {
        k: 'p',
        t: 'The game starts mounting a different folder, and every mod you installed stays behind in the old one. Nothing is lost and nothing is broken; the game is simply looking somewhere else. The app can move your mods across when it notices, and by hand it is a matter of moving the pakNN files into the new folder.',
      },

      { k: 'h2', t: 'Four voice languages, three folders', id: 'four' },
      {
        k: 'p',
        t: 'Dota records hero speech in four languages: English, Russian, Simplified Chinese and Korean. Three of them have a folder in the game directory - <code>dota_russian</code>, <code>dota_schinese</code>, <code>dota_koreana</code> - and English does not, because English speech is what the base game already carries. Every other language Dota offers, Dutch and German and the rest, is text only. There is no recorded speech behind them, so Valve ships no folder for them either.',
      },
      {
        k: 'p',
        t: 'Those three folders are on the disk of everybody who has Dota installed, whether or not they ever downloaded the speech that goes in them. That is the detail the rest of this page turns on.',
      },

      { k: 'h2', t: 'The Steam language and the audio language are two settings', id: 'steam' },
      {
        k: 'p',
        t: 'The language in the Steam properties of Dota decides which voice pack is on your disk. The audio language inside the game decides which one it plays. Different places, different jobs, and they do not have to agree.',
      },
      {
        k: 'p',
        t: 'Steam keeps exactly one pack. Pick Russian in the properties and it downloads Russian speech; pick Korean later and it deletes the Russian and downloads the Korean. Gigabytes each way, every time. English downloads nothing, because it is already in the base game, so switching the properties to English is how you delete whatever pack you had.',
      },
      {
        k: 'p',
        t: 'And if the game is told to play a pack that is not on disk, it falls back to English. Nothing is broken and nothing is missing: English is the floor everything else sits on.',
      },

      { k: 'h2', t: 'What this app does with that', id: 'method' },
      {
        k: 'p',
        t: 'It sets the audio language inside the game to one of the three that have a folder, and puts mods in that folder. For anybody whose Steam language is English the pack was never downloaded, so the folder mounts carrying nothing but mods, and the speech stays English because that is the fallback. What you hear does not change. The text language stays whatever you chose.',
      },
      {
        k: 'p',
        t: 'No launch option, no folder made by hand, no extra archive to undo a side effect. It is the setting the game already has, doing the thing it does.',
      },

      { k: 'h2', t: 'Why the launch option is the worse route', id: 'why-not' },
      {
        k: 'p',
        t: 'A real language still works as an argument: <code>-language dutch</code> sets the text to Dutch, leaves the speech English, and mounts <code>dota_dutch</code>. That is what the older guides teach and what some tools still do. Three things come with it.',
      },
      {
        k: 'list',
        items: [
          'The folder does not exist. It has to be created, with a <code>gameinfo.gi</code> of its own copied from a real language folder.',
          'Both language settings are locked while the argument is there. The menus inside the game cannot change them back, so getting English text again means putting an archive of the English localization into that folder.',
          'A program setting this up has to write into the configuration files of Steam itself to put the argument there.',
        ],
      },
      {
        k: 'p',
        t: 'There is also what Valve did in July. Folders invented out of nothing stopped mounting. The languages with no speech of their own are the closest thing left to an invented folder, while the three with speech have to be mounted for that speech to play at all. Preferring those three costs nothing and asks nothing of Steam.',
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          [
            'Which languages does Dota record voices in?',
            'Four, and that list has nothing to do with the twenty-nine the interface is translated into. Three of them get a folder: <code>dota_russian</code>, <code>dota_koreana</code>, <code>dota_schinese</code>. English is the fourth and has none, because English speech lives inside the base game. <a href="~/docs/install/#english">What to do if your audio is English</a>.',
          ],
          ['Is a separate mods folder still possible?', 'Not by making up a name. Mods go in the language folder your game already mounts, in their own pak slots, which is what the app does.'],
          ['Do I need to edit gameinfo.gi?', 'No. Guides that teach editing it are working around the same problem from the other side, and editing a file the client checks is a worse trade than using a folder that already works.'],
        ],
      },
    ],
  },

  'own-mods': {
    slug: 'own-mods',
    title: 'Your own Dota 2 mods: install, unpack, combine',
    h1: 'Your own mods: installing, unpacking, combining',
    description:
      'Install your own .vpk into Dota 2, import a whole folder of mods you already had, unpack an installed mod back into files, and combine several mods into one pak slot.',
    lead: 'The catalog is not the only source. The app takes any VPK, recognises what is already sitting in your game folder, and takes mods apart again into the files they are made of.',
    card: 'Your own .vpk, a folder of old mods, unpacking, combining and splitting paks.',
    blocks: [
      { k: 'h2', t: 'Installing your own .vpk', id: 'vpk' },
      {
        k: 'p',
        t: 'Drag the file onto the window, or use the import button. The app reads what is inside it, works out what it changes and which heroes it touches, gives it a name if it has none, and puts it in a free pak slot. From then on it behaves like anything else in your library: it switches off, it reorders, it survives patches.',
      },

      { k: 'h2', t: 'A whole folder at once', id: 'folder' },
      {
        k: 'p',
        t: 'If you have been installing mods by hand for a while, point the app at the folder they are in and it takes every archive out of it in one go, rather than asking you to add them one at a time. It looks a few levels down, because packs from other tools unzip into a whole game tree with the file you want buried in it.',
      },

      { k: 'h2', t: 'A folder with no archive in it: your own mod', id: 'pack' },
      {
        k: 'p',
        t: 'Point it at a folder holding loose game files rather than a VPK, and it packs them into one for you and imports the result. This is the case an author has and no installer covers: you have been editing files in a working folder and had nothing to point anything at. The folder\'s own name becomes the mod\'s name.',
      },
      {
        k: 'p',
        t: 'It works out where your content actually starts, so a wrapper folder left by unzipping, or a game-shaped <code>MyMod/game/dota_russian/models/</code>, both resolve to the same archive. Folders of your own sitting next to the game\'s come along too.',
      },

      { k: 'h2', t: 'It recognises mods you installed by hand', id: 'adopt' },
      {
        k: 'p',
        t: 'The app fingerprints what is already in your game folder and compares it against the catalog. Where it finds a match it tells you which mod that file is and offers to take it under management, so a folder somebody else set up becomes a library you can actually read. Files it does not recognise are listed too, rather than being quietly overwritten.',
      },

      { k: 'h2', t: 'Unpacking a mod back into files', id: 'unpack' },
      {
        k: 'p',
        t: 'An installed mod can be unpacked back into a folder of the files it contains. That is where editing somebody else\'s mod starts, and it is also the quickest way to see what a mod really touches when the description is vague.',
      },

      { k: 'h2', t: 'Combining and splitting', id: 'packs' },
      {
        k: 'p',
        t: 'Several mods can be combined into one pak, and a pack can be taken apart again into the mods it was built from. Useful when the slots are running short, and useful when a set of mods should move together as one thing.',
      },

      { k: 'h2', t: 'The tools that make mods', id: 'tools' },
      {
        k: 'p',
        t: 'Making a mod rather than installing one means decompiling a game asset, editing it, compiling it back and packing it into a VPK. The tools for that live in the catalog\'s Tools section and install from inside the app, and the catalog\'s wiki is the documentation for the pipeline. <a href="~/docs/catalog/">Where those come from</a>.',
      },
      {
        k: 'p',
        t: 'Or describe the mod to an AI assistant and let it run those tools for you: <a href="~/docs/ai-mods/">making mods with AI</a>.',
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Can I install a mod from a zip?', 'Yes. Archives from the catalog often come that way and the app unpacks them itself.'],
          ['Will my own mod survive a Dota patch?', 'The same as any other. A patch overwrites the files underneath, and the repair puts your archives back where they were.'],
          ['Can I share a mod I made?', 'The catalog takes submissions, and its Discord is where that conversation happens.'],
        ],
      },
    ],
  },

  'ai-mods': {
    slug: 'ai-mods',
    title: 'Make Dota 2 mods with AI: skins, effects, models, animations',
    h1: 'Make Dota 2 mods with AI',
    description:
      'Describe the skin you want and an AI assistant builds it: recoloured spells, arcanas from the game files, new models, animations, sounds and icons, packed into a VPK. One line sets it up.',
    lead: 'Tell an AI assistant what your hero should look like and it builds the mod: it reads the game\'s files, runs Valve\'s compiler, checks the result and hands you a VPK to drag into the app. The knowledge it works from is a skill in our repository, written down while we built a full custom Necrophos set this way.',
    card: 'Describe a skin in words; Claude Code or another assistant builds the VPK. One line sets it up.',
    updated: '2026-10-26',
    blocks: [
      { k: 'h2', t: 'Set it up with one line', id: 'setup' },
      {
        k: 'p',
        t: 'Open an AI coding assistant that can run commands on your computer (Claude Code, Codex, Cursor, Gemini CLI and the like) and send it this:',
      },
      { k: 'prompt', t: SETUP_PROMPT },
      {
        k: 'p',
        t: 'The link is a page of instructions written for the assistant, not for you. It clones the repository, installs the skill, checks which tools your computer has and asks before it installs anything. When it finishes it tells you what works and what you can ask for.',
      },
      {
        k: 'p',
        t: 'In Claude Code the skill also installs as a plugin, which keeps it updated. Run these two in a session:',
      },
      { k: 'prompt', t: PLUGIN_ADD },
      { k: 'prompt', t: PLUGIN_INSTALL },

      { k: 'h2', t: 'What you can ask for', id: 'what' },
      {
        k: 'cards',
        items: [
          ['Effects in any colour', '"Make Necrophos\' spells blood red." Every particle and status effect of a hero, recoloured and compiled. Needs only Dota and Node.js.'],
          ['Items you do not own', '"Give me Terrorblade\'s arcana." Arcanas, immortals and sets taken from the game\'s own files, with their effects and animations.'],
          ['New models', '"A Ghostface mask and a hooded cloak." The assistant models in Blender, fits the mesh to the hero\'s skeleton and compiles it into the slot it replaces.'],
          ['Animations', '"He should pull a knife on spawn." New idle, attack, run, cast and spawn clips, swapped into the hero\'s model so the game plays them.'],
          ['Sounds and voice', '"Scream when he casts." Replace a sound, layer one on top, or add lines to the voice.'],
          ['Icons and portraits', 'Ability icons, the portrait, the minimap icon and the hero-picker video, edited as pictures and compiled back.'],
        ],
      },
      {
        k: 'p',
        t: 'The rule underneath all of it: a mod replaces files the game already has. A new mask goes where an existing head item lives, a new clip in place of an existing clip. The skill knows which file each change lands in, so it will tell you when an idea needs a different route.',
      },

      { k: 'h2', t: 'How a mod gets made', id: 'how' },
      {
        k: 'steps',
        items: [
          ['It asks', 'Which hero, every change as a list you confirm, pictures of what you mean, where it has to look right. A big set goes in stages, each one shown before the next.'],
          ['It plans from the game\'s data', 'It reads the item table, the hero\'s model, its sound events and icons from your game files instead of guessing paths.'],
          ['It builds', 'Recolours, decompiles, models, compiles with Valve\'s Workshop Tools, all in a work folder outside the game.'],
          ['It checks', 'The mod doctor reads the finished VPK against the game in seconds: animations that need an item turned on, sequence numbers that differ from the game\'s, effects on the wrong attachment.'],
          ['It shows you', 'Renders from Blender, and with your permission a short film from the game itself: the bench starts Dota, puts the hero on screen and records it.'],
          ['You install it', 'Drag the VPK into Dota 2 Mod Manager. It switches off in one click and survives patches like any other mod.'],
        ],
      },

      { k: 'h2', t: 'What your computer needs', id: 'needs' },
      {
        k: 'list',
        items: [
          '<b>Dota 2 and Node.js 24.</b> Enough for recolours and items from the game\'s files, on any system.',
          '<b>Dota 2 Workshop Tools</b> for anything compiled: models, textures, animations, sounds, icons. Steam, Dota 2, Properties, DLC. Windows only.',
          '<b>Source2Viewer</b> to decompile the game\'s files, <b>Blender</b> for models and animations, <b>Python</b> with Pillow and numpy for textures.',
        ],
      },
      {
        k: 'p',
        t: 'You do not have to install these yourself. The assistant runs <code>modkit check</code>, tells you what is missing for the mod you asked for, and installs it once you agree.',
      },

      { k: 'h2', t: 'Where it comes from', id: 'source' },
      {
        k: 'p',
        t: 'Everything in the skill was learned on real mods: Terrorblade\'s arcana built from the game\'s files, and "Scream", a Necrophos set with a new mask, hood, cloak, scythe and knife, red effects, new animations, sounds, icons and a hero-picker scene. Each mistake that cost a day there is a line in its pitfalls table now. The skill, its scripts and the <code>modkit</code> commands are open source in <a href="https://github.com/dota2modmanager/dota2-mod-manager/tree/main/skills/dota2-modding">skills/dota2-modding</a>.',
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Does it cost anything?', 'The skill and the tools are free. The AI assistant is your own, on whatever plan you already use.'],
          ['Which assistant works best?', 'Any agent that can run commands and read files. The skill is written in the Agent Skills format Claude Code reads natively; other agents follow the same files through a line in AGENTS.md, which the setup adds.'],
          ['Do other players see my skin?', 'No. A mod changes the files on your computer, so only you see it. Everyone else sees the default hero.'],
          ['Will it touch my game?', 'It works in its own folder and builds the VPK there. Only the app writes into the game, when you install the mod.'],
          ['Can I share what it made?', 'Yes, with the catalog\'s community. Mind what you put in: a model or sound from somewhere else carries its author\'s licence.'],
        ],
      },
    ],
  },

  catalog: {
    slug: 'catalog',
    title: 'The D2PFX catalog: what it is and who runs it',
    h1: 'The D2PFX catalog',
    description:
      'The open catalog of Dota 2 mods this app installs from: how many mods, which categories, who maintains it, where its wiki and Discord are, and why the app reads it live.',
    lead: 'Every mod this app installs comes from one place, and I did not make that place. This page is about what the catalog is, who runs it, and why it is the best open collection of Dota 2 mods there is.',
    card: 'Who h6rd is, what is in the catalog, the wiki and the tools, and how the app connects to it.',
    blocks: [
      { k: 'h2', t: 'What it is', id: 'what' },
      {
        k: 'p',
        t: 'D2PFX is an open catalog of cosmetic mods for Dota 2, run by <b>h6rd</b> with the community. {mods} {modsWord} in {categories} {categoriesWord}: hero skins, hero items, terrains, trees, the river, shaders, effects, couriers, wards, announcers, music, cursors, fonts, Roshan, mega-kills. Every mod carries a preview, tags saying what it really changes, an author and a date. It has been going for over a year and grows on its own schedule rather than in releases.',
      },
      {
        k: 'p',
        t: 'D2PFX is short for the catalog\'s own name, which is spelled out on <a href="https://github.com/h6rd/Dota2PornFxWeb">its repository</a>. The short form is used here because search engines and video platforms read the full one as adult content and quietly hide whatever page carries it, which helps nobody and least of all the people who made these mods.',
      },

      { k: 'h2', t: 'What is in it right now', id: 'inside' },
      { k: 'p', t: 'Counted from the catalog when this page was built:' },
      { k: 'categories' },

      { k: 'h2', t: 'Why this one', id: 'why' },
      {
        k: 'list',
        items: [
          '<b>It is open.</b> The site and the data are in a public GitHub repository under GPL-3.0. The list of mods is an ordinary JSON file that anything can read, which is exactly how this app reads it.',
          '<b>It is alive.</b> Mods arrive continuously. A collection that updates twice a year is a different kind of object.',
          '<b>It is sorted.</b> Categories, grouping by hero, tags that describe the actual change rather than the marketing, and a preview for nearly everything.',
          '<b>It documents itself.</b> The wiki teaches making mods, not just installing them.',
          '<b>It ships tools.</b> A Tools section with the VPK utilities, a compiler and a patcher, maintained by the same author.',
        ],
      },

      { k: 'h2', t: 'The wiki, which is the good part', id: 'wiki' },
      {
        k: 'p',
        t: 'Most mod sites tell you where to put a file. The catalog\'s wiki tells you how the file was made: decompiling a game asset, editing it, compiling it back, packing it into a VPK, and which folder inside the archive each kind of resource has to sit in for the engine to find it. Icons, sounds, styles and fonts all live in different places and only some of them need compiling. If you want to stop installing other people\'s mods and start making your own, that is where to go.',
      },

      { k: 'h2', t: 'How this app is connected to it', id: 'link' },
      {
        k: 'list',
        items: [
          'It reads the catalog\'s data over the network, so a mod added today is installable today, with no app update and no new release.',
          'It downloads mod files from the catalog\'s own addresses. Nothing is re-hosted here.',
          'The Tools section installs from inside the app.',
          'It fingerprints mods already in your game folder against the catalog, which is how it can tell you what a file you installed by hand actually is.',
          'The manager itself is listed in the catalog\'s Tools section.',
        ],
      },

      { k: 'h2', t: 'Credit, and the limits of it', id: 'credit' },
      {
        k: 'p',
        t: 'The catalog and the mods in it belong to the people who made them. This app installs them and takes no money for it, from anyone. If you made something shown here and want it credited differently, or gone, the Discord is the fastest way and it gets done.',
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          [
            'Is this the catalog\'s official app?',
            'No. The catalog and this app are separate projects by different people. The manager is listed in the catalog\'s Tools section, but the catalog stands on its own and the app reads it as open data.',
          ],
          [
            'Why is it called that?',
            'The author named it years ago and that is the name it is known by. It says nothing about the contents: the catalog is cosmetic mods for Dota 2, sorted by hero and category.',
          ],
          ['Can I install from the catalog by hand?', 'Yes. Download the file from the site and rename it into a free pak slot. <a href="~/docs/install/#manual">The manual route</a>.'],
          ['Does the app work without the catalog?', 'Yes, for your own files. <a href="~/docs/own-mods/">Installing your own .vpk</a>. The catalog is where the browsable collection comes from.'],
        ],
      },
    ],
  },

  minify: {
    slug: 'minify',
    title: 'Dota2 Minify: what it is, and using it with this app',
    h1: 'Dota2 Minify',
    description:
      'Dota2 Minify is a separate open-source Dota 2 mod patcher by Egezenn: what it does, the mods it ships, its community depot, and how it runs alongside this manager.',
    lead: 'If you want to customise Dota further than a catalog of skins can take you, install Minify as well. It is a different kind of tool by a different author, it does things this app does not do, and the two run in the same game folder without fighting.',
    card: 'A separate mod patcher by Egezenn, what it changes, and how to run it alongside this app.',
    blocks: [
      {
        k: 'note',
        t: 'Minify is not mine. It is written and maintained by <a href="https://github.com/Egezenn">Egezenn</a>, I have never worked on it, and neither project is affiliated with the other. This page is here because a lot of people use both, and because everything below can be checked in Minify\'s own repository.',
      },

      { k: 'h2', t: 'What it is', id: 'what' },
      {
        k: 'p',
        t: '<a href="https://github.com/Egezenn/dota2-minify">Dota2 Minify</a> describes itself as a "Dota2 Mod Patcher &amp; Toolkit for everyone to use mods easily". It is open source under GPL-3.0, written in Python with a DearPyGui interface and a command line of its own, and it ships for Windows and Linux, with an <a href="https://aur.archlinux.org/packages/dota2-minify-bin">AUR package</a> and partial macOS support from source. Its Windows builds are code-signed through the SignPath Foundation, and its interface is translated by volunteers on Weblate.',
      },
      {
        k: 'p',
        t: 'Where this app downloads finished mod files and drops them into the game folder, Minify <b>builds</b> them on your machine. It pulls the assets it needs out of Dota\'s own archives, decompiles them with Source 2 Viewer, edits them (regex passes run through ripgrep), compiles them back with Valve\'s resource compiler and packs the result into a VPK. Because of that a patch takes a while, and some of its mods need the Dota 2 Workshop Tools installed from Steam.',
      },

      { k: 'h2', t: 'What it can change', id: 'mods' },
      { k: 'p', t: 'The 31 mods it ships, named as it names them, grouped by what they are for.' },
      {
        k: 'cards',
        items: [
          [
            'Performance',
            'Misc Optimization, Minify Base Attacks, Minify Spells &amp; Items, Remove Foilage, Remove River, Remove Weather Effects, Remove Hero Renders, Remove Showcases, Remove Sprays, Tree Mod, Dark Terrain.',
          ],
          [
            'Sound',
            'Mute Ambient Sounds, Mute Default Announcer, Mute Default Kill Spree Sounds, Mute Taunt Sounds, Mute Voice Line Sounds, Revert Ping Sounds, Remove Pings.',
          ],
          [
            'Interface',
            'Transparent HUD, Reposition &amp; Rescale HUD, Repopulate Unit Query HUD, Revamp Hero Grid Layout, Custom Hero Grids, Custom Fonts, Custom Backgrounds, Remove Main Menu Background, User Styles.',
          ],
          [
            'While you play',
            'Auto Accept Match, Show NetWorth, Stat Site Buttons, OpenDotaGuides Guides.',
          ],
        ],
      },
      {
        k: 'p',
        t: 'They come from more than one person. Egezenn wrote many of them; <a href="https://github.com/robbyz512">robbyz512</a> wrote most of the performance and sound ones, <a href="https://github.com/MeGaNeKoS">MeGaNeKoS</a> the match and net worth ones, and Transparent HUD comes from ZerdacK of the Dota Modding Community. The full table with every author is in <a href="https://github.com/Egezenn/dota2-minify#special-thanks-to">its readme</a>.',
      },

      { k: 'h2', t: 'The community depot', id: 'community' },
      {
        k: 'p',
        t: 'Minify can read mod depots outside its own build. The one it ships with is <a href="https://github.com/Egezenn/dota2-minify-community">dota2-minify-community</a>, which holds four ready-made packs and four separate mods:',
      },
      {
        k: 'list',
        items: [
          '<b>#&nbsp;Optimizations</b> - "all the optimizations Minify has to offer", in one pack.',
          '<b>#&nbsp;Shut It</b> - mutes the annoying sounds and more.',
          '<b>#&nbsp;Flavor</b> - UI improvements and third-party integrations. Some of it needs the Workshop Tools.',
          '<b>#&nbsp;Old Timer</b> - for people who want the legacy version of features back.',
          '<b>As-Is FoW</b> by Egezenn - fog of war with no wobble and sharp edges.',
          '<b>Default Skins</b> by Lupin - puts every skin back to its default, and can be taken in parts: particles, skins, couriers or wards alone.',
          '<b>Simple Dark Terrain</b> by Robby - a dark grid terrain.',
          '<b>Settings Copier</b> by prosto saneyk - copies hotkeys, video, audio and guides between Steam accounts, and can follow you as you switch.',
        ],
      },
      {
        k: 'p',
        t: 'The other depot it lists is <a href="~/docs/catalog/">D2PFX</a>, the same catalog this app installs from. Both tools read it.',
      },

      { k: 'h2', t: 'Why you might want both', id: 'both' },
      {
        k: 'p',
        t: 'They overlap almost nowhere. This app installs finished cosmetic mods from an open catalog: hero sets, terrains, couriers, wards, effects, announcers, cursors. Minify rebuilds parts of the game itself: it strips foliage and weather to gain frames, mutes sound categories, moves the HUD, puts guides and stat buttons where the game has none. A skin catalog cannot do the second thing and a patcher is not where you go browsing for hero sets.',
      },
      {
        k: 'p',
        t: 'So the honest answer to "which one" is often neither on its own. Take the catalog from here and the game changes from there.',
      },

      { k: 'h2', t: 'Running both', id: 'together' },
      {
        k: 'p',
        t: 'This app works with Minify installed. Not "should work" - it is built for it, and the parts below are in the code:',
      },
      {
        k: 'list',
        items: [
          '<b>One folder, both sets of mods.</b> Dota mounts a single language folder. Minify picks one and points Steam at it; this app reads which folder the game will really mount and installs there, so your mods from both land where the game looks. Mods already installed move themselves across on the next start.',
          '<b>Its slots stay free.</b> pak65, pak66 and pak67 are never handed out here, whether or not Minify is on the machine, so somebody who installs it next month does not find a mod quietly replaced.',
          '<b>Its files are left alone.</b> The master mods switch skips them, and the scan for unmanaged files does not offer them up for adopting or deleting. They are recognised by the metadata Minify packs into what it builds, which is the same check Minify uses itself.',
          '<b>The map archive is asked about.</b> Dota reads one <code>maps/dota.vpk</code>, so a terrain from either tool is the same file. This app checks who wrote the one that is there and asks before replacing it.',
          '<b>It says what it sees.</b> If Minify is set to run a patch before the game starts, or the launch options point somewhere unexpected, the Library page names it in plain words instead of leaving you with a game that does nothing.',
        ],
      },
      {
        k: 'p',
        t: 'It goes the other way too. This app leaves a <code>dota2modmanager.json</code> in the language folder listing what it installed, and Minify from v1.14rc7 checks ownership before clearing the map folder during its uninstall, so a terrain installed here survives one.',
      },

      { k: 'h2', t: 'Where to get it', id: 'get' },
      {
        k: 'list',
        items: [
          'Site and downloads: <a href="https://egezenn.github.io/dota2-minify">egezenn.github.io/dota2-minify</a>',
          'Wiki, including how to write a mod for it: <a href="https://egezenn.github.io/dota2-minify/wiki">the wiki</a>',
          'Source: <a href="https://github.com/Egezenn/dota2-minify">GitHub</a>, mirrored on <a href="https://codeberg.org/egezenn/dota2-minify">Codeberg</a>',
          'Support and its community: <a href="https://discord.com/invite/9867CPv7cy">Discord</a>, <a href="https://t.me/dota2minify">Telegram</a>',
        ],
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          [
            'Do you make Minify, or get paid for sending people to it?',
            'No to both. It is Egezenn\'s project, I have no part in it, no money moves in either direction, and this app is free as well. The two of us have talked about staying out of each other\'s way, and that is the whole relationship.',
          ],
          [
            'Which do I install first?',
            'Either. If Minify is already there, this app finds the folder it chose and joins it. If you add Minify afterwards, the slots it needs were never taken.',
          ],
          [
            'Will installing both break my game?',
            'Two mods that change the same file still cannot both apply, exactly as two mods from one catalog cannot. That is a collision between mods, not between the tools, and this app names collisions on screen. <a href="~/docs/vpk/#order">How load order works</a>.',
          ],
          [
            'Can Minify install mods from the catalog too?',
            'It lists D2PFX among its depots, yes. What this app adds is browsing the catalog with previews, one-click install, load order, presets and adopting files you already have.',
          ],
          [
            'It needs the Workshop Tools. Is that normal?',
            'For some of its mods, yes: they compile game assets, and the compiler comes with the Dota 2 Workshop Tools from Steam. Mods installed from here never need them, because they arrive already built.',
          ],
        ],
      },
    ],
  },
  copies: {
    slug: 'copies',
    title: 'Fake copies of Dota 2 Mod Manager: how to tell the real one',
    h1: 'Copies of this app, and how to tell the real one',
    description:
      'Dota 2 Mod Manager is free, open source and has no paid version. Four signs of a copy you should not run, and the only addresses that are ours.',
    lead: 'We keep finding this app under other names: renamed, closed, sometimes for money. Some of them run our code with our name taken off. You cannot check what else they do, and you do not need them, because the original costs nothing.',
    card: 'Paid launchers, renamed copies, apps that want a login. Four signs, and the addresses that are really ours.',
    updated: '2026-10-19',
    blocks: [
      { k: 'h2', t: 'What is going around', id: 'what' },
      {
        k: 'p',
        t: 'Launchers that look like this one or do what it does, under a name of their own, with no source code and no word about where they came from. Some sell a subscription, a premium tier or keys. Some make you sign in before they show a single mod. A few are this app with its name changed and its authors removed.',
      },
      {
        k: 'p',
        t: 'The original is free, open and needs no account. So each of these takes something from you that the original does not: money, a password, or the chance to read what you are running.',
      },

      { k: 'h2', t: 'Four signs', id: 'signs' },
      {
        k: 'cards',
        items: [
          ['No source code', 'The original is GPL-3.0. Anyone may build on that code and even charge for a copy, but whoever hands you one has to give you its source too, under the same licence. No source means nobody can read what the program does, and its maker is breaking the licence it was built under.'],
          ['No word about where it came from', 'The licence also keeps the original authors\' notices in every copy. A launcher that calls itself new and names nothing it is built on hides the first thing you would want to know.'],
          ['It wants money', 'Dota 2 Mod Manager has never charged for anything. It has no subscription, no premium tier, no keys and no locked mods. A launcher asking you to pay for the same job is charging you for something free.'],
          ['It wants a login or your data', 'Installing a mod means putting a file into your game folder. That takes no Steam login, no password, no phone number and no card. The one sign-in the original has is optional, happens on discord.com, and only puts your name on a setup you share.'],
        ],
      },

      { k: 'h2', t: 'Where the real one lives', id: 'official' },
      {
        k: 'list',
        items: [
          '<a href="~/">dota2modmanager.com</a>, this site. Its download buttons take the file straight from the GitHub releases page.',
          '<a href="https://github.com/dota2modmanager/dota2-mod-manager" rel="noopener">github.com/dota2modmanager/dota2-mod-manager</a>, the source code and every release, each built by a <a href="https://github.com/dota2modmanager/dota2-mod-manager/actions" rel="noopener">public workflow</a>. The old address, github.com/TheFleece/dota2-mod-manager, leads there.',
          '<a href="https://gitlab.com/TheFleece/dota2-mod-manager" rel="noopener">gitlab.com/TheFleece/dota2-mod-manager</a>, a mirror of the same repository.',
          '<a href="https://discord.gg/PBvG8D9MxT" rel="noopener">The Discord server</a>, where the people who make it answer.',
        ],
      },
      {
        k: 'p',
        t: 'The D2PFX catalog, where the mods come from, lists the app in its own Tools section and links here. Anything else that looks like this app did not come from us.',
      },

      { k: 'h2', t: 'Forks that say so', id: 'forks' },
      {
        k: 'p',
        t: 'You may build on this code, and we are glad when people do. A fair fork names what it is built on, publishes its own source and keeps the licence. If you like one of those better, use it. The four signs are about the copies that hide where they came from.',
      },

      { k: 'h2', t: 'If you already paid or signed in', id: 'already' },
      {
        k: 'list',
        items: [
          'Change the password you typed into it, and the same password anywhere else you use it. If it was your Steam password, change it in Steam and sign out of every other device from the Steam Guard page.',
          'If you paid, ask your bank or the payment service how to dispute the charge, and keep the receipt.',
          'Remove the copy, then get the original from this site. It recognises the mods already in your game folder and takes them over. <a href="~/docs/own-mods/#adopt">How that works</a>.',
          'Tell us where you found it, on <a href="https://discord.gg/PBvG8D9MxT" rel="noopener">Discord</a> or at <a href="mailto:hello@dota2modmanager.com">hello@dota2modmanager.com</a>, so we can warn the next person.',
        ],
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Is there a paid or Pro version of Dota 2 Mod Manager?', 'No. There is one version, it is free, and every feature is in it. A Pro, Premium or VIP Dota 2 Mod Manager is not ours.'],
          ['A launcher does the same thing under another name. Is it safe?', 'Ask it for its source code and for what it is built on. If it shows you neither, you cannot know what else it does on your computer, and the original does the same job for free.'],
          ['Can someone sell this app?', 'The licence allows charging for a copy, as long as the buyer gets the full source under GPL-3.0 and the original notices stay in. You never have to buy it: the same program is free here.'],
        ],
      },
    ],
  },

  compare: {
    slug: 'compare',
    title: 'Choosing a Dota 2 mod manager: what to check',
    h1: 'How to choose a Dota 2 mod manager',
    description:
      'What to check before running any Dota 2 mod installer: source, who built the file, what it asks for, whether its catalog is live. With honest answers for this one and the alternatives.',
    lead: 'You are about to let a program write into your game folder. Five questions decide whether that is a reasonable thing to do, and they are the same five whatever you end up installing.',
    card: 'Five questions to ask any mod installer, answered for this one and for the alternatives.',
    blocks: [
      { k: 'h2', t: 'The five questions', id: 'questions' },
      {
        k: 'cards',
        items: [
          ['Can you read the source?', 'Not "source available on request". A repository that opens right now, with the code the release was built from.'],
          ['Who built the file you downloaded?', 'A public CI job leaves a log anybody can open. A file uploaded from somebody\'s desktop leaves their word.'],
          ['What does it ask for?', 'A mod installer needs your game folder. It does not need a Steam login, your inventory or a password. Anything asking is doing something other than installing files.'],
          ['Where do its mods come from?', 'A collection baked into the build ages with the build. One read live grows without anybody shipping anything.'],
          ['What happens when two mods collide?', 'Two mods carrying the same file cannot both apply. A manager that does not mention this is leaving you to work it out from the map.'],
        ],
      },

      { k: 'h2', t: 'This one, answered', id: 'here' },
      {
        k: 'list',
        items: [
          '<b>Source:</b> GPL-3.0, the whole repository, every release tagged.',
          '<b>Builds:</b> GitHub Actions, workflow and logs public.',
          '<b>Asks for:</b> the game folder. Signing in with Discord is optional and only puts your name on a setup you share.',
          '<b>Mods:</b> read live from the D2PFX catalog, {mods} of them. <a href="~/docs/catalog/">What that is</a>.',
          '<b>Collisions:</b> named on screen, with the load order editable from the same place.',
          '<b>Cost:</b> free, with nothing paid inside and no ads.',
        ],
      },

      { k: 'h2', t: 'The alternatives', id: 'others' },
      {
        k: 'p',
        t: 'Said as they say it themselves, because that is the only fair way to put somebody else\'s software on your own page.',
      },
      {
        k: 'cards',
        items: [
          [
            'DOTA Mods Installer (dota2mods.com)',
            'The big one. Its site states over 3,400 mods and over 8,300 mod parts, Windows only, with a shuffle mode, a texture and particle editor, and user uploads. It is not open source, and the site offers a donation to remove ads. If catalog size is what decides it for you, it is larger than ours. What it is not is a manager: it builds a pack, and putting that pack into the game folder, taking it back out and keeping track of what is in it stays your job.',
          ],
          [
            'd2mm (github.com/SebRut/d2mm)',
            'Open source under MIT, and genuinely early: install ordering and a package creator. Its last commit is from January 2015, which is five Dota engines and one whole game version ago. It does not work with the game as it ships today.',
          ],
          [
            'd2modmanager (github.com/philface)',
            'Open source, "without vpk injection", last touched in February 2015. Of historical interest.',
          ],
          [
            'Dota2 Minify (github.com/Egezenn/dota2-minify)',
            'Not an alternative and not a rival. It builds mods by patching the game where this installs finished ones from a catalog, and the two are made to run together: this app installs into whichever folder the game will really mount, including the one Minify picked, keeps pak65 to pak67 free for it, and leaves its files alone. Install both and you get the catalog from here and the game changes from there. <a href="~/docs/minify/">What Minify is, and running the two together</a>.',
          ],
          [
            'Dota 2 SkinChanger (dota2changer.com)',
            'A website rather than a program: you pick mods in a browser, it generates a VPK pack, and you place that pack in the game folder yourself. Part of its collection is behind a paid tier. Nothing updates itself afterwards, and a pack built last month is the pack you keep.',
          ],
          [
            'Skin changers and inventory changers (Overplus, MetaSkins and the like)',
            'A different category of thing. They advertise unlocking items you do not own, they are closed source, with no public build anybody can check. Where this app adds a file next to the game and can take it back, these change the files of the game itself, and you have their word for what else they touch.',
          ],
          [
            'Renamed copies of this app',
            'Launchers that run this app\'s code under a name of their own, closed and with no word about where they came from, some of them for money or behind a login. They are not ours, and you cannot check what else they do. <a href="~/docs/copies/">Four signs of one</a>.',
          ],
          [
            'Umbrella and other cheat platforms',
            'Not a mod manager at all. Those sell scripts and automation that play parts of the match for you, which is the one thing in this whole area that Valve does ban accounts for. If a page offers you mods and scripts from the same download, close it.',
          ],
        ],
      },

      { k: 'h2', t: 'What this one is not best at', id: 'weak' },
      {
        k: 'list',
        items: [
          'No Mac build. Windows and Linux are both supported and both shipped with every release; macOS is not, and Dota runs there through a translation layer that this has never been tested against.',
          'The catalog is smaller than the largest one out there. It is curated, previewed and open, which is a different trade.',
          'The installer is unsigned, so Windows warns about it on first run. <a href="~/docs/safe/#smartscreen">Why, and what to do</a>.',
          'It does not edit textures. Recolouring a mod is a job for the catalog\'s tools. <a href="~/docs/own-mods/#tools">Those</a>.',
        ],
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Can I run two managers at once?', 'With Minify, yes, and it is set up for that: <a href="~/docs/minify/#together">how the two share a game</a>. With anything else, badly - both write into the same folder and neither knows what the other did. This one at least notices foreign files and says so instead of overwriting them.'],
          ['I already installed mods with something else. Do I start over?', 'No. Point this at your game folder and it identifies what is there and takes it over. <a href="~/docs/own-mods/#adopt">How that works</a>.'],
          ['Which is safest?', 'The one whose code you can read and whose build you can check. That is a property of the tool, not a promise from its author.'],
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Russian
// ---------------------------------------------------------------------------

const ru: Record<Slug, Doc> = {
  uninstall: {
    slug: 'uninstall',
    title: 'Как удалить моды с Доты 2 и вернуть всё как было',
    h1: 'Как удалить моды в Доте 2',
    description:
      'Убрать один мод, выключить все разом или вернуть Доту 2 в исходный вид: через мод-менеджер и руками, вместе со шрифтами, курсорами и патчем схемы.',
    lead: 'Удалить мод значит три разных вещи: убрать один, погасить все на одну катку и не оставить следов совсем. Ниже все три и что при этом происходит с файлами.',
    card: 'Один мод, все моды сразу или полный откат к чистой игре. Шрифты, курсоры и патч тоже.',
    blocks: [
      { k: 'h2', t: 'Убрать один мод', id: 'one' },
      {
        k: 'steps',
        items: [
          ['Открой «Мои моды»', 'Там всё установленное, у каждого мода свой переключатель.'],
          ['Нажми «Удалить»', 'Файл уходит из папки игры, запись - из библиотеки. Игра возвращается к тому виду, что был до этого мода.'],
          ['Перезапусти Доту', 'Игра читает архивы при старте, поэтому уже запущенный клиент ничего не заметит.'],
        ],
      },

      { k: 'h2', t: 'Выключить - это не удалить', id: 'off' },
      {
        k: 'p',
        t: 'Если мод понадобится завтра, удалять его незачем. Переключатель рядом с модом гасит его: файл переименовывается, мод остаётся в библиотеке, обратно включается одним кликом. Отдельная кнопка гасит все моды разом - то, что нужно перед турнирной каткой или сразу после патча, когда ещё непонятно, что именно сломалось.',
      },

      { k: 'h2', t: 'Руками, без программы', id: 'manual' },
      {
        k: 'p',
        t: 'Мод - это файл pakNN_dir.vpk в языковой папке, которую монтирует игра. Удали файл, и мода нет.',
      },
      {
        k: 'steps',
        items: [
          [
            'Открой языковую папку',
            'Обычно <code>...\\steamapps\\common\\dota 2 beta\\game\\dota_russian</code>, и названа она по языку озвучки, а не интерфейса. <a href="~/docs/language/">Какая папка твоя</a>.',
          ],
          ['Посмотри на номера pak', 'Моды - это pak02_dir.vpk и до pak99_dir.vpk. Всё в этой папке, что не pak01, пришло со стороны.'],
          ['Удали лишние', 'Дырки в нумерации допустимы: игре всё равно, есть ли pak04, если есть pak05.'],
        ],
      },
      {
        k: 'note',
        t: 'Никогда не удаляй <code>pak01_dir.vpk</code> и лежащие рядом <code>pak01_NNN.vpk</code>. Это файлы самой игры, и после их удаления придётся чинить установку через Steam.',
      },

      { k: 'h2', t: 'Шрифты и курсоры', id: 'fonts' },
      {
        k: 'p',
        t: 'Эти двое не ложатся слоем поверх, а заменяют файлы, поэтому программа копирует оригиналы до установки и возвращает их при удалении мода. Если ставил шрифт руками и копию не делал, вернуть его поможет проверка целостности файлов в Steam.',
      },

      { k: 'h2', t: 'Вернуть чистую игру', id: 'reset' },
      {
        k: 'list',
        items: [
          'Включи безопасный режим обратно: виды со стандартных предметов снимутся. Программа вернёт <code>gameinfo_branchspecific.gi</code> и <code>dota.signatures</code> из копий, снятых до первой записи.',
          'Удали всё в «Моих модах».',
          'Если что-то ставил руками, загляни в языковую папку: там могли остаться pakNN_dir.vpk.',
          'В Steam: свойства игры, «Установленные файлы», проверить целостность. Это вернёт всё, что принадлежит Valve.',
          'Саму программу можно удалить обычным путём, через «Установленные приложения» Windows.',
        ],
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Удаление мода уберёт косметику из инвентаря?', 'Нет. Программа не касается аккаунта Steam, инвентарь остаётся как был.'],
          [
            'Проверка целостности в Steam снесёт моды?',
            'Она возвращает файлы, которые принадлежат игре. Лишние pakNN_dir.vpk в языковой папке она обычно не трогает, так что если цель - убрать моды, удаляй их файлы сам.',
          ],
          [
            'Мод удалён, а в игре он всё ещё есть.',
            'Перезапусти игру полностью: архивы читаются при старте. Если не помогло, скорее всего те же файлы несёт второй мод. <a href="~/docs/vpk/">Как игра выбирает победителя</a>.',
          ],
        ],
      },
    ],
  },

  terrain: {
    slug: 'terrain',
    title: 'Как поставить терраин на Доту 2 в 2026 году',
    h1: 'Терраины: как поставить свой ландшафт в Доте 2',
    description:
      'Установка терраина на Дота 2 через мод-менеджер или руками, почему все гайды с -language tempcontent перестали работать в июле 2026 и как к ландшафту подходят деревья и река.',
    lead: 'Терраин - самый заметный мод в Доте и обычная причина, по которой человек вообще приходит в моддинг. Все гайды с первой страницы выдачи учат приёму, который умер 24 июля 2026 года.',
    card: 'Ландшафты, деревья и река. Почему -language tempcontent больше не работает и как ставить терраин сейчас.',
    blocks: [
      { k: 'h2', t: 'Что такое терраин', id: 'what' },
      {
        k: 'p',
        t: 'Ландшафт, он же терраин, меняет карту: землю, обрывы, деревья, реку, эффекты вокруг. Технически это обычный мод, архив VPK с моделями и текстурами, положенный поверх игровых. В каталоге ландшафты, деревья и река лежат отдельными категориями, потому что их часто мешают: земля от одного автора, деревья от другого.',
      },

      { k: 'h2', t: 'Почему старые гайды не работают', id: 'broken' },
      {
        k: 'p',
        t: 'Почти каждый гайд по терраинам учит одному и тому же: допиши <code>-language tempcontent</code> в параметры запуска и положи мод в папку <code>dota_tempcontent</code>. 24 июля 2026 года Дота перестала брать язык из этого аргумента. Оба языка теперь лежат в <code>game/dota/cfg/boot.vcfg</code>, а в путь поиска движок подставляет язык озвучки. Выдуманное значение вроде tempcontent больше не создаёт папку и не монтирует её, поэтому мод не грузится вообще.',
      },
      {
        k: 'p',
        t: 'Сам аргумент никуда не делся и язык по-прежнему ставит. Он просто больше не умеет придумывать папку из ничего. <a href="~/docs/language/">Вся история с языковой папкой</a>.',
      },

      { k: 'h2', t: 'Через программу', id: 'app' },
      {
        k: 'steps',
        items: [
          ['Открой «Ландшафты» в каталоге', 'У каждого терраина есть превью, так что видно, что берёшь, до того как оно окажется на диске.'],
          ['Нажми «Установить»', 'Программа скачает мод, положит его в свободный слот pak в ту папку, которую игра реально монтирует, и запомнит, что записала.'],
          ['Перезапусти Доту', 'Запущенный клиент мод не подхватит, закрой его полностью.'],
        ],
      },
      {
        k: 'p',
        t: 'Деревья, реку и шейдеры программа кладёт в слоты с меньшими номерами, чем сам ландшафт, потому что при совпадении файлов выигрывает меньший номер. Именно это позволяет держать землю одного автора под деревьями другого.',
      },

      { k: 'h2', t: 'Руками', id: 'manual' },
      {
        k: 'steps',
        items: [
          ['Найди свою языковую папку', 'Она названа по языку озвучки, а не интерфейса. <a href="~/docs/language/">Как понять, какая</a>.'],
          ['Переименуй файл', 'В свободный pakNN_dir.vpk, где NN - любое незанятое от 02 до 99. Никогда не 01.'],
          ['Положи и перезапусти игру', 'Это весь механизм. Без параметров запуска и без правки файлов игры.'],
        ],
      },

      { k: 'h2', t: 'Терраин, деревья и река вместе', id: 'combo' },
      {
        k: 'p',
        t: 'Эти трое пересекаются. Терраин со своими деревьями и отдельный мод на деревья несут одни и те же файлы, и выиграть может только один: тот, что лежит в слоте с меньшим номером. Программа говорит, какой именно, и даёт перетащить их в другом порядке. При установке руками это выясняется уже на карте.',
      },

      { k: 'h2', t: 'Что ломает терраин', id: 'breaks' },
      {
        k: 'list',
        items: [
          'Патч игры переписал файлы, на которых мод держался. Обычное дело, ради этого и существует восстановление.',
          'Поставлено два терраина сразу. Один из них ничего не делает.',
          'Мод лежит в папке, которую игра не монтирует: ровно то, к чему приводили старые гайды.',
          'Осталась папка <code>dota_tempcontent</code> с тех времён, и в ней лежат моды, которые ты считаешь установленными.',
        ],
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Терраины бесплатные?', 'Те, что в каталоге, - да. Valve тоже продаёт ландшафты, и мод их не заменяет: он меняет то, что видишь ты, а не то, чем владеет аккаунт.'],
          ['Другие игроки увидят мой терраин?', 'Нет. Его рисует твой клиент на твоём экране. У остальных карта та, которую поставили они.'],
          ['Сколько терраинов можно поставить?', 'Сколько угодно, но работать будет один. Остальные лучше выключить, чем оставлять спорить.'],
          ['Терраин влияет на фпс?', 'Может, в обе стороны. Некоторые тяжелее валвовского, а категория оптимизации в каталоге существует ровно для обратного.'],
        ],
      },
    ],
  },

  announcer: {
    slug: 'announcer',
    title: 'Как поставить аннонсера в Доте 2: моды и бесплатные',
    h1: 'Аннонсеры и озвучка в Доте 2',
    description:
      'Два способа сменить комментатора в Дота 2: мод с чужой озвучкой из каталога или аннонсер, который уже есть на аккаунте. Плюс мега-киллы, звуки героев и почему важна папка.',
    lead: 'Комментатор меняется двумя разными путями, и это не одно и то же. Один ставит чужую запись файлом, второй включает то, что тебе и так принадлежит.',
    card: 'Мод с озвучкой или аннонсер из инвентаря. Мега-киллы, звуки героев и зачем перезапуск.',
    blocks: [
      { k: 'h2', t: 'Два разных способа', id: 'two' },
      {
        k: 'cards',
        items: [
          [
            'Мод с озвучкой',
            'Кто-то записал набор фраз и упаковал их в VPK. Он меняет то, что ты слышишь, независимо от того, чем владеет аккаунт, и лежит в папке игры как любой другой мод.',
          ],
          [
            'Аннонсер, который уже твой',
            'Аннонсеры из наборов, боевых пропусков и дропов лежат без дела, потому что клиент показывает только то, что считает надетым. Это список, а не файл, и его можно поправить локально. <a href="~/docs/cosmetics/">Как устроена таблица предметов</a>.',
          ],
        ],
      },

      { k: 'h2', t: 'Ставим мод с озвучкой', id: 'mod' },
      {
        k: 'steps',
        items: [
          ['Открой «Комментаторы» в каталоге', 'У большинства есть превью, которое можно послушать до установки.'],
          ['Нажми «Установить»', 'Программа положит мод в свободный слот pak в ту папку, которую монтирует игра.'],
          ['Перезапусти Доту', 'Звук грузится при старте, как и всё остальное.'],
        ],
      },
      {
        k: 'note',
        t: 'Голос лежит в папке, названной по языку <b>озвучки</b>, а не интерфейса. Смена языка озвучки в настройках Доты уводит игру в другую папку, а твои моды с голосом остаются в старой. <a href="~/docs/language/">Почему так</a>.',
      },

      { k: 'h2', t: 'Мега-киллы и звуки героев', id: 'mega' },
      {
        k: 'p',
        t: 'Мега-киллы и звуковые паки героев работают так же и лежат в своих категориях каталога. С модом на аннонсера они спорят только тогда, когда несут одни и те же фразы, и программа об этом скажет.',
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Соперники слышат моего аннонсера?', 'Нет. Каждый слышит то, что надел сам.'],
          [
            'Мод встал, а ничего не поменялось.',
            'Две обычные причины: игру не перезапустили полностью, или мод уехал в языковую папку, которую твоя игра не монтирует. <a href="~/docs/troubleshooting/">Разбор по симптомам</a>.',
          ],
          ['Можно совмещать аннонсера с мега-киллами?', 'Да, пока они не несут одни и те же файлы. Если несут, программа скажет.'],
        ],
      },
    ],
  },

  language: {
    slug: 'language',
    title: 'Папка dota_russian и почему -language mods не работает',
    h1: 'Языковая папка: куда на самом деле кладутся моды',
    description:
      'Какую папку монтирует Дота 2 после патча 24 июля 2026: UILanguage и AudioLanguage в boot.vcfg, почему dota_tempcontent больше не создаётся и как найти свою папку.',
    lead: 'Все моды для Доты живут в папке, названной по языку. Какая именно - решает файл настроек игры, а не параметр запуска, и это поменялось 24 июля 2026 года.',
    card: 'boot.vcfg, UILanguage против AudioLanguage и почему выдуманная папка больше не монтируется.',
    blocks: [
      { k: 'h2', t: 'Откуда берётся имя папки', id: 'name' },
      {
        k: 'p',
        t: 'В путях поиска Доты есть запись с подстановкой языка, и при старте движок подставляет туда настоящее значение. Какое бы оно ни было, папка <code>game/dota_&lt;значение&gt;</code> монтируется, и всё, что в ней лежит, грузится поверх игровых архивов. На этом механизме и держатся моды. Ничего не патчится и никуда не внедряется: в папку, куда движок и так смотрит, добавляется ещё один архив.',
      },

      { k: 'h2', t: 'Языка два, а не один', id: 'two' },
      {
        k: 'p',
        t: 'Июльский патч 2026 года разделил настройку надвое и перенёс обе в <code>game/dota/cfg/boot.vcfg</code>:',
      },
      { k: 'code', t: '"boot"\n{\n\t"UILanguage"    "russian"\n\t"AudioLanguage" "russian"\n}' },
      {
        k: 'p',
        t: 'Здесь важен <b>AudioLanguage</b>. Именно его движок подставляет в путь поиска, поэтому смена языка озвучки просит перезапуск, а смена языка интерфейса нет. Текст интерфейса лежит в игровом pak01 сразу на всех языках, и своей папки у него никогда не было.',
      },

      { k: 'h2', t: 'Почему -language mods перестал работать', id: 'dead' },
      {
        k: 'p',
        t: 'Старый трюк держался на том, что аргумент принимал что угодно. Ты писал <code>-language mods</code> или <code>-language tempcontent</code>, движок подставлял это слово в путь поиска, и появлялась папка, куда можно было спрятать моды подальше от настоящих языковых. Теперь слово, которого Дота не знает как язык, не даёт ничего. Папка не создаётся, не монтируется, и моды в ней не грузятся.',
      },
      {
        k: 'p',
        t: 'Аргумент работает и язык по-прежнему ставит. Он просто больше не выдумывает папку. Каждый гайд, который до сих пор учит этому шагу, отправляет людей в каталог, который игра никогда не откроет, и это самая частая причина, по которой правильно поставленный мод ничего не делает.',
      },

      { k: 'h2', t: 'Что со всем этим делает параметр запуска', id: 'launch' },
      {
        k: 'p',
        t: '<code>-language</code> в параметрах запуска Steam стоит <b>выше</b> настройки в boot.vcfg. Это измерено, а не предположено: на машине с <code>-language dutch</code> и записанным в boot.vcfg <code>AudioLanguage russian</code> игра смонтировала <code>dota_dutch</code> и <code>dota_russian</code> не открыла вовсе. В консольном логе перечислено смонтированное, и русской папки там нет.',
      },
      {
        k: 'p',
        t: 'Порядок такой: <code>-language</code> с настоящим языком Доты побеждает всё; если его нет, решает AudioLanguage из boot.vcfg; а <code>-language</code> с выдуманным словом не решает ничего, потому что папку по нему движок не смонтирует. Ещё параметр блокирует обе языковые настройки, пока стоит, поэтому язык текста перестаёт меняться в самой игре.',
      },
      {
        k: 'note',
        t: 'Именно этим пользуются другие инструменты для модов: ставят язык, на котором никто не играет, наполняют названную им папку и возвращают английский текст отдельным архивом. Это работает, и поэтому мод, положенный в папку по языку твоей озвучки, всё равно может ничего не делать. Приложение читает параметр запуска и ставит моды в ту папку, которую игра действительно смонтирует.',
      },

      { k: 'h2', t: 'Как найти свою папку', id: 'find' },
      {
        k: 'steps',
        items: [
          ['Открой папку игры', 'Steam, правой кнопкой по Dota 2, «Управление», «Просмотреть локальные файлы», дальше в <code>game</code>.'],
          ['Сначала посмотри параметры запуска', 'Steam, правой кнопкой по Dota 2, «Свойства». Если там есть <code>-language что-то</code>, решает он, и папка это <code>dota_что-то</code>.'],
          ['Параметра нет - читай boot.vcfg', 'Текстовый файл в <code>game/dota/cfg/</code>. Ответ это AudioLanguage, и папка та, что совпадает с ним.'],
        ],
      },
      {
        k: 'note',
        t: 'Ни одной папки <code>dota_</code> нет? Значит озвучка английская, а для неё Valve папку не поставляет: английская речь лежит внутри базовой игры. Создать папку самому тоже нельзя, а переключение озвучки на русскую, корейскую или китайскую английских голосов тебя не лишает. <a href="~/docs/install/#english">Весь случай целиком</a>.',
      },
      {
        k: 'p',
        t: 'Программа делает это за тебя и показывает папку, в которую пишет. В первый раз туда стоит взглянуть.',
      },

      { k: 'h2', t: 'Если сменить язык озвучки', id: 'switch' },
      {
        k: 'p',
        t: 'Игра начинает монтировать другую папку, а все поставленные моды остаются в старой. Ничего не пропало и не сломалось, игра просто смотрит в другое место. Программа умеет перенести моды, когда это замечает; руками это перенос файлов pakNN в новую папку.',
      },

      { k: 'h2', t: 'Четыре языка озвучки, три папки', id: 'four' },
      {
        k: 'p',
        t: 'Реплики героев Дота записывает на четырёх языках: английский, русский, китайский и корейский. У трёх из них есть папка в каталоге игры - <code>dota_russian</code>, <code>dota_schinese</code>, <code>dota_koreana</code>. У английского её нет, потому что английская речь и так лежит в самой игре. Все остальные языки Доты, нидерландский, немецкий и прочие, это только текст: озвучки за ними нет, поэтому и папки Valve для них не кладёт.',
      },
      {
        k: 'p',
        t: 'Эти три папки есть на диске у каждого, у кого установлена Дота, независимо от того, качал он когда-нибудь эту озвучку или нет. На этой детали держится всё остальное на странице.',
      },

      { k: 'h2', t: 'Язык в Steam и язык озвучки в игре - две разные настройки', id: 'steam' },
      {
        k: 'p',
        t: 'Язык в свойствах Доты в Steam решает, какая озвучка лежит у тебя на диске. Язык озвучки внутри игры решает, какую из них играть. Разные места, разные задачи, и совпадать они не обязаны.',
      },
      {
        k: 'p',
        t: 'Steam держит ровно одну озвучку. Выбрал русский в свойствах - скачалась русская речь; выбрал потом корейский - русская удалилась, скачалась корейская. И так гигабайты туда и обратно каждый раз. Английский не качает ничего, он и так в игре, поэтому переключение свойств на английский это способ удалить ту озвучку, которая у тебя была.',
      },
      {
        k: 'p',
        t: 'А если игре сказали играть озвучку, которой на диске нет, она откатывается на английскую. Ничего не сломано и ничего не пропало: английский это основа, поверх которой лежит всё остальное.',
      },

      { k: 'h2', t: 'Что с этим делает приложение', id: 'method' },
      {
        k: 'p',
        t: 'Ставит язык озвучки внутри игры на один из трёх, у которых есть папка, и кладёт моды в эту папку. У того, у кого в Steam стоит английский, эта озвучка никогда не качалась, поэтому папка монтируется, не неся ничего кроме модов, а речь остаётся английской - это откат по умолчанию. На слух ничего не меняется. Язык текста остаётся тот, который ты выбрал.',
      },
      {
        k: 'p',
        t: 'Ни параметра запуска, ни папки, созданной руками, ни отдельного архива, чтобы отменить побочный эффект. Это собственная настройка игры, использованная по назначению.',
      },

      { k: 'h2', t: 'Почему параметр запуска - путь хуже', id: 'why-not' },
      {
        k: 'p',
        t: 'Настоящий язык параметром работает: <code>-language dutch</code> ставит текст на нидерландский, речь оставляет английской и монтирует <code>dota_dutch</code>. Так учат старые гайды и так до сих пор делают некоторые инструменты. Вместе с этим приезжает три вещи.',
      },
      {
        k: 'list',
        items: [
          'Папки не существует. Её надо создать и положить внутрь свой <code>gameinfo.gi</code>, скопированный из настоящей языковой папки.',
          'Обе языковые настройки блокируются, пока параметр стоит. Меню внутри игры их обратно не поменяет, поэтому вернуть английский текст можно только положив в эту папку архив с английской локализацией.',
          'Программе, которая всё это настраивает, приходится писать в конфигурационные файлы самого Steam.',
        ],
      },
      {
        k: 'p',
        t: 'И ещё то, что Valve сделали в июле. Папки, выдуманные из ничего, монтироваться перестали. Языки без собственной озвучки - самое близкое к выдуманной папке, что осталось, а три языка с озвучкой игра обязана монтировать, иначе этой озвучке негде звучать. Держаться этих трёх ничего не стоит и ничего не просит у Steam.',
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          [
            'На каких языках у Доты есть озвучка?',
            'На четырёх, и этот список никак не связан с двадцатью девятью языками перевода интерфейса. Папка есть у трёх: <code>dota_russian</code>, <code>dota_koreana</code>, <code>dota_schinese</code>. Английский четвёртый, и папки у него нет, потому что английская речь лежит внутри базовой игры. <a href="~/docs/install/#english">Что делать, если озвучка английская</a>.',
          ],
          ['Можно ли всё-таки держать моды в отдельной папке?', 'Придумав ей имя - нет. Моды кладутся в ту языковую папку, которую игра и так монтирует, в свои слоты pak. Это то, что делает программа.'],
          ['Надо ли править gameinfo.gi?', 'Нет. Гайды, которые учат его править, заходят к той же проблеме с другой стороны, и менять файл, который клиент проверяет, - обмен хуже, чем воспользоваться папкой, которая и так работает.'],
        ],
      },
    ],
  },

  'own-mods': {
    slug: 'own-mods',
    title: 'Свои моды в Доте 2: поставить .vpk, распаковать, собрать',
    h1: 'Свои моды: поставить, распаковать, объединить',
    description:
      'Как поставить свой .vpk в Дота 2, забрать целую папку старых модов, распаковать установленный мод обратно в файлы и объединить несколько модов в один слот pak.',
    lead: 'Каталог - не единственный источник. Программа берёт любой VPK, узнаёт то, что уже лежит в папке игры, и разбирает моды обратно на файлы, из которых они собраны.',
    card: 'Свой .vpk, папка со старыми модами, распаковка, объединение и разбор паков.',
    blocks: [
      { k: 'h2', t: 'Поставить свой .vpk', id: 'vpk' },
      {
        k: 'p',
        t: 'Перетащи файл в окно или нажми импорт. Программа прочитает, что внутри, поймёт, что мод меняет и каких героев трогает, придумает ему имя, если своего нет, и положит в свободный слот pak. Дальше он ведёт себя как всё остальное в библиотеке: выключается, переставляется в порядке, переживает патчи.',
      },

      { k: 'h2', t: 'Целую папку разом', id: 'folder' },
      {
        k: 'p',
        t: 'Если ты давно ставишь моды руками, укажи программе папку, где они лежат, и она заберёт из неё все архивы за один раз, а не попросит добавлять их по одному. Смотрит она и на несколько уровней вглубь: паки от других инструментов распаковываются в целое дерево игры, и нужный файл лежит где-то внутри.',
      },

      { k: 'h2', t: 'Папка без архива: свой мод из сырых файлов', id: 'pack' },
      {
        k: 'p',
        t: 'Укажи папку, где лежат не VPK, а сами файлы игры, и программа соберёт из них архив сама и тут же его поставит. Это случай автора, который не закрывает ни один установщик: ты правишь файлы в рабочей папке, и указать инструменту было не на что. Именем мода становится имя папки.',
      },
      {
        k: 'p',
        t: 'Где начинается контент, она определяет сама, поэтому и обёртка, оставшаяся от распаковки, и путь игрового вида <code>МойМод/game/dota_russian/models/</code> сводятся к одному и тому же архиву. Твои собственные папки рядом с игровыми тоже поедут внутрь.',
      },

      { k: 'h2', t: 'Программа узнаёт моды, поставленные руками', id: 'adopt' },
      {
        k: 'p',
        t: 'Она считает отпечатки того, что уже лежит в папке игры, и сверяет их с каталогом. Где нашлось совпадение - говорит, что это за мод, и предлагает взять его под управление, так что чужая папка превращается в библиотеку, которую можно читать. То, что не опознано, тоже показывается списком, а не затирается молча.',
      },

      { k: 'h2', t: 'Распаковать мод обратно в файлы', id: 'unpack' },
      {
        k: 'p',
        t: 'Установленный мод можно распаковать обратно в папку с его файлами. С этого начинается правка чужого мода, и это же самый быстрый способ увидеть, что мод трогает на самом деле, когда описание расплывчатое.',
      },

      { k: 'h2', t: 'Объединить и разобрать', id: 'packs' },
      {
        k: 'p',
        t: 'Несколько модов складываются в один пак, а пак разбирается обратно на моды, из которых собран. Полезно, когда кончаются слоты, и полезно, когда набор модов должен ходить вместе как одна вещь.',
      },

      { k: 'h2', t: 'Инструменты, которыми моды делают', id: 'tools' },
      {
        k: 'p',
        t: 'Сделать мод, а не поставить, значит декомпилировать игровой ресурс, отредактировать, скомпилировать обратно и запаковать в VPK. Инструменты для этого лежат в разделе Tools каталога и ставятся прямо из программы, а вики каталога - документация ко всему конвейеру. <a href="~/docs/catalog/">Откуда это всё</a>.',
      },
      {
        k: 'p',
        t: 'Или опиши мод ИИ-ассистенту, и он сам прогонит эти инструменты: <a href="~/docs/ai-mods/">моды с помощью ИИ</a>.',
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Можно поставить мод из zip?', 'Да. Из каталога они часто приходят именно так, и программа распаковывает их сама.'],
          ['Мой мод переживёт патч Доты?', 'Так же, как любой другой. Патч переписывает файлы под ним, а восстановление возвращает архивы на место.'],
          ['Можно поделиться модом, который я сделал?', 'Каталог принимает работы, а его Discord - место, где этот разговор происходит.'],
        ],
      },
    ],
  },

  'ai-mods': {
    slug: 'ai-mods',
    title: 'Моды для Доты 2 с помощью ИИ: скины, эффекты, модели',
    h1: 'Моды для Доты 2 с помощью ИИ',
    description:
      'Опиши скин словами, и ИИ-ассистент соберёт его: перекрашенные спеллы, арканы из файлов игры, новые модели, анимации, звуки и иконки, упакованные в VPK. Настраивается одной строкой.',
    lead: 'Расскажи ИИ-ассистенту, как должен выглядеть твой герой, и он соберёт мод: прочитает файлы игры, прогонит компилятор Valve, проверит результат и отдаст VPK, который ты перетащишь в программу. Всё, что он для этого знает, лежит скиллом в нашем репозитории. Мы записали его, пока так же собирали полный кастомный сет на Некрофоса.',
    card: 'Опиши скин словами, а Claude Code или другой ассистент соберёт VPK. Настройка одной строкой.',
    updated: '2026-10-26',
    blocks: [
      { k: 'h2', t: 'Настройка одной строкой', id: 'setup' },
      {
        k: 'p',
        t: 'Открой ИИ-ассистента, который умеет запускать команды на твоём компьютере (Claude Code, Codex, Cursor, Gemini CLI и подобные), и отправь ему:',
      },
      { k: 'prompt', t: SETUP_PROMPT_RU },
      {
        k: 'p',
        t: 'По ссылке лежит инструкция для ассистента, не для тебя. Он склонирует репозиторий, поставит скилл, проверит, какие инструменты есть на компьютере, и спросит, прежде чем что-то устанавливать. В конце скажет, что уже работает и что можно у него просить.',
      },
      {
        k: 'p',
        t: 'В Claude Code скилл ставится ещё и плагином, тогда он сам обновляется. Запусти в сессии эти две команды:',
      },
      { k: 'prompt', t: PLUGIN_ADD },
      { k: 'prompt', t: PLUGIN_INSTALL },

      { k: 'h2', t: 'Что можно попросить', id: 'what' },
      {
        k: 'cards',
        items: [
          ['Эффекты в любом цвете', '«Сделай спеллы Некрофоса кроваво-красными». Все партиклы и статус-эффекты героя, перекрашенные и скомпилированные. Хватит Доты и Node.js.'],
          ['Предметы, которых у тебя нет', '«Дай мне аркану Террорблейда». Арканы, иммортал-предметы и сеты из файлов самой игры, вместе с эффектами и анимациями.'],
          ['Новые модели', '«Маску Гостфейса и плащ с капюшоном». Ассистент моделит в Blender, сажает меш на скелет героя и компилирует в слот, который тот заменяет.'],
          ['Анимации', '«Пусть на спавне достаёт нож». Новые клипы стойки, атаки, бега, каста и спавна, подменённые в модели героя, чтобы игра их играла.'],
          ['Звуки и голос', '«Пусть кричит, когда кастует». Заменить звук, наложить свой поверх или добавить реплики в озвучку.'],
          ['Иконки и портреты', 'Иконки способностей, портрет, значок на миникарте и видео в пике героя: правятся как картинки и компилируются обратно.'],
        ],
      },
      {
        k: 'p',
        t: 'Правило под всем этим одно: мод заменяет файлы, которые в игре уже есть. Новая маска встаёт на место существующего предмета на голову, новый клип на место существующего клипа. Скилл знает, в какой файл ложится каждая правка, так что сам скажет, если идее нужен другой путь.',
      },

      { k: 'h2', t: 'Как собирается мод', id: 'how' },
      {
        k: 'steps',
        items: [
          ['Расспрашивает', 'Какой герой, все правки списком, который ты подтверждаешь, картинки того, что имеешь в виду, где должно смотреться. Большой сет идёт этапами, каждый показывается до следующего.'],
          ['Планирует по данным игры', 'Читает таблицу предметов, модель героя, его звуковые события и иконки прямо из файлов игры, а не угадывает пути.'],
          ['Собирает', 'Перекрашивает, декомпилирует, моделит, компилирует через Workshop Tools от Valve, всё в рабочей папке вне игры.'],
          ['Проверяет', 'Доктор модов за секунды сверяет готовый VPK с игрой: анимации, которым нужен включённый предмет, номера анимаций, разошедшиеся с игровыми, эффекты не на той точке крепления.'],
          ['Показывает', 'Рендеры из Blender, а с твоего разрешения и короткое видео из самой игры: стенд запускает Доту, выводит героя на экран и записывает.'],
          ['Ты ставишь', 'Перетащи VPK в Dota 2 Mod Manager. Выключается в один клик и переживает патчи, как любой другой мод.'],
        ],
      },

      { k: 'h2', t: 'Что нужно на компьютере', id: 'needs' },
      {
        k: 'list',
        items: [
          '<b>Дота 2 и Node.js 24.</b> Этого хватит на перекраску и предметы из файлов игры, на любой системе.',
          '<b>Dota 2 Workshop Tools</b> для всего, что компилируется: моделей, текстур, анимаций, звуков, иконок. Steam, Dota 2, Свойства, Дополнительный контент. Только Windows.',
          '<b>Source2Viewer</b>, чтобы декомпилировать файлы игры, <b>Blender</b> для моделей и анимаций, <b>Python</b> с Pillow и numpy для текстур.',
        ],
      },
      {
        k: 'p',
        t: 'Ставить это самому не надо. Ассистент запустит <code>modkit check</code>, скажет, чего не хватает для твоего мода, и поставит, когда ты согласишься.',
      },

      { k: 'h2', t: 'Откуда это', id: 'source' },
      {
        k: 'p',
        t: 'Всё в скилле выучено на настоящих модах: аркана Террорблейда из файлов игры и «Крик», сет на Некрофоса с новой маской, капюшоном, плащом, косой и ножом, красными эффектами, новыми анимациями, звуками, иконками и сценой в пике героя. Каждая ошибка, на которую там ушёл день, теперь строчка в таблице ловушек. Скилл, его скрипты и команды <code>modkit</code> открыты в <a href="https://github.com/dota2modmanager/dota2-mod-manager/tree/main/skills/dota2-modding">skills/dota2-modding</a>.',
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Это платно?', 'Скилл и инструменты бесплатные. ИИ-ассистент твой собственный, на том тарифе, что у тебя уже есть.'],
          ['Какой ассистент лучше?', 'Любой агент, который запускает команды и читает файлы. Скилл написан в формате Agent Skills, который Claude Code читает сам; другие агенты идут по тем же файлам через строчку в AGENTS.md, её добавит настройка.'],
          ['Другие игроки увидят мой скин?', 'Нет. Мод меняет файлы на твоём компьютере, так что видишь его только ты. Остальные видят обычного героя.'],
          ['Он полезет в мою игру?', 'Он работает в своей папке и там же собирает VPK. В игру пишет только программа, когда ты ставишь мод.'],
          ['Можно поделиться тем, что он сделал?', 'Да, с сообществом каталога. Смотри, что кладёшь внутрь: модель или звук из чужого источника несут лицензию своего автора.'],
        ],
      },
    ],
  },

  catalog: {
    slug: 'catalog',
    title: 'Каталог D2PFX: что это и кто его ведёт',
    h1: 'Каталог D2PFX',
    description:
      'Открытый каталог модов для Доты 2, из которого программа ставит моды: сколько модов, какие категории, кто его ведёт, где вики и Discord и почему приложение читает его напрямую.',
    lead: 'Все моды, которые ставит эта программа, лежат в одном месте, и это место сделал не я. Страница о том, что это за каталог, кто его ведёт и почему он лучшая открытая коллекция модов для Доты.',
    card: 'Кто такой h6rd, что внутри каталога, вики и инструменты, и как с ним связана программа.',
    blocks: [
      { k: 'h2', t: 'Что это', id: 'what' },
      {
        k: 'p',
        t: 'D2PFX - открытый каталог косметических модов для Доты 2, который ведёт <b>h6rd</b> вместе с сообществом. {mods} {modsWord} в {categories} {categoriesWord}: скины на героев, предметы, ландшафты, деревья, река, шейдеры, эффекты, курьеры, варды, аннонсеры, музыка, курсоры, шрифты, Рошан, мега-киллы. У каждого мода есть превью, теги, которые говорят, что он меняет на самом деле, автор и дата. Каталогу больше года, и он растёт своим ходом, а не релизами.',
      },
      {
        k: 'p',
        t: 'D2PFX - это сокращение от полного названия каталога, оно написано целиком в <a href="https://github.com/h6rd/Dota2PornFxWeb">его репозитории</a>. Сокращение используется потому, что поисковики и видеоплатформы читают полное название как взрослый контент и тихо прячут страницу, которая его несёт. От этого не выигрывает никто, и меньше всех - авторы этих модов.',
      },

      { k: 'h2', t: 'Что в нём сейчас', id: 'inside' },
      { k: 'p', t: 'Посчитано по каталогу в момент сборки этой страницы:' },
      { k: 'categories' },

      { k: 'h2', t: 'Почему именно он', id: 'why' },
      {
        k: 'list',
        items: [
          '<b>Он открытый.</b> Сайт и данные лежат в публичном репозитории на GitHub под GPL-3.0. Список модов - обычный JSON, который может прочитать что угодно. Именно так его и читает эта программа.',
          '<b>Он живой.</b> Моды появляются постоянно. Коллекция, которая обновляется дважды в год, - другой по сути объект.',
          '<b>Он разложен.</b> Категории, разбивка по героям, теги про настоящее изменение, а не про рекламу, и превью почти у всего.',
          '<b>Он себя документирует.</b> Вики учит делать моды, а не только ставить их.',
          '<b>В нём есть инструменты.</b> Раздел Tools: утилиты для VPK, компилятор и патчер, от того же автора.',
        ],
      },

      { k: 'h2', t: 'Вики, и это лучшая его часть', id: 'wiki' },
      {
        k: 'p',
        t: 'Большинство сайтов с модами объясняют, куда положить файл. Вики каталога объясняет, как этот файл сделан: декомпилировать игровой ресурс, отредактировать, скомпилировать обратно, запаковать в VPK, и в какой папке внутри архива должен лежать каждый тип ресурса, чтобы движок его нашёл. Иконки, звуки, стили и шрифты лежат в разных местах, и компилировать нужно не всё. Если хочется перестать ставить чужие моды и начать делать свои - идти туда.',
      },

      { k: 'h2', t: 'Как с ним связана программа', id: 'link' },
      {
        k: 'list',
        items: [
          'Она читает данные каталога по сети, поэтому мод, добавленный сегодня, ставится сегодня - без обновления программы и без нового релиза.',
          'Файлы модов она качает с адресов самого каталога. Здесь ничего не перезалито.',
          'Раздел Tools ставится прямо из программы.',
          'Она сверяет отпечатки модов, уже лежащих в папке игры, с каталогом - так она и может сказать, что за файл ты поставил руками.',
          'Сам менеджер лежит в разделе Tools этого каталога.',
        ],
      },

      { k: 'h2', t: 'Уважение и его границы', id: 'credit' },
      {
        k: 'p',
        t: 'Каталог и моды в нём принадлежат тем, кто их сделал. Эта программа их только ставит и денег за это не берёт ни с кого. Если ты автор чего-то показанного здесь и хочешь другую подпись или чтобы это убрали - быстрее всего через Discord, и так и будет.',
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          [
            'Это официальное приложение каталога?',
            'Нет. Каталог и программа - разные проекты разных людей. Менеджер лежит в разделе Tools каталога, но каталог живёт сам по себе, а программа читает его как открытые данные.',
          ],
          [
            'Почему он так называется?',
            'Автор назвал его так много лет назад, и под этим именем его знают. К содержимому это отношения не имеет: внутри косметические моды для Доты 2, разложенные по героям и категориям.',
          ],
          ['Можно ставить моды из каталога руками?', 'Да. Скачай файл с сайта и переименуй в свободный слот pak. <a href="~/docs/install/#manual">Как это делается</a>.'],
          ['Программа работает без каталога?', 'Со своими файлами - да. <a href="~/docs/own-mods/">Как поставить свой .vpk</a>. Каталог - это то, откуда берётся коллекция, которую можно листать.'],
        ],
      },
    ],
  },

  minify: {
    slug: 'minify',
    title: 'Dota2 Minify: что это и как работает с этим приложением',
    h1: 'Dota2 Minify',
    description:
      'Dota2 Minify - отдельный патчер модов для Доты 2 с открытым кодом, автор Egezenn: что он умеет, какие моды в нём есть, комьюнити-репозиторий и как он уживается с этим менеджером.',
    lead: 'Если хочешь настроить Доту дальше, чем позволяет каталог скинов, поставь ещё и Minify. Это инструмент другого рода и другого автора, он делает то, чего не делает это приложение, и обе программы живут в одной папке игры без драки.',
    card: 'Отдельный патчер модов от Egezenn: что он меняет и как держать его вместе с этим приложением.',
    blocks: [
      {
        k: 'note',
        t: 'Minify не мой. Его пишет и поддерживает <a href="https://github.com/Egezenn">Egezenn</a>, я над ним никогда не работал, и проекты друг с другом никак не связаны. Страница есть потому, что многие пользуются обоими, и потому, что всё написанное ниже можно проверить в его собственном репозитории.',
      },

      { k: 'h2', t: 'Что это', id: 'what' },
      {
        k: 'p',
        t: '<a href="https://github.com/Egezenn/dota2-minify">Dota2 Minify</a> сам себя описывает как «Dota2 Mod Patcher &amp; Toolkit for everyone to use mods easily» - патчер и набор инструментов, чтобы модами было просто пользоваться. Открытый код под GPL-3.0, написан на Python с интерфейсом на DearPyGui и собственной командной строкой, собирается под Windows и Linux, есть <a href="https://aur.archlinux.org/packages/dota2-minify-bin">пакет в AUR</a> и частичная поддержка macOS из исходников. Сборки под Windows подписаны через SignPath Foundation, интерфейс переводят добровольцы на Weblate.',
      },
      {
        k: 'p',
        t: 'Это приложение скачивает готовые файлы модов и кладёт их в папку игры. Minify моды <b>собирает</b> у тебя на машине: достаёт нужные ресурсы из архивов самой Доты, декомпилирует их через Source 2 Viewer, правит (regex-проходы идут через ripgrep), компилирует обратно валвовским компилятором и пакует в VPK. Поэтому патч идёт не мгновенно, а части его модов нужны Dota 2 Workshop Tools, которые ставятся из Steam.',
      },

      { k: 'h2', t: 'Что он умеет менять', id: 'mods' },
      { k: 'p', t: '31 мод, который в нём есть, названия как у него, сгруппированы по назначению.' },
      {
        k: 'cards',
        items: [
          [
            'Производительность',
            'Misc Optimization, Minify Base Attacks, Minify Spells &amp; Items, Remove Foilage, Remove River, Remove Weather Effects, Remove Hero Renders, Remove Showcases, Remove Sprays, Tree Mod, Dark Terrain.',
          ],
          [
            'Звук',
            'Mute Ambient Sounds, Mute Default Announcer, Mute Default Kill Spree Sounds, Mute Taunt Sounds, Mute Voice Line Sounds, Revert Ping Sounds, Remove Pings.',
          ],
          [
            'Интерфейс',
            'Transparent HUD, Reposition &amp; Rescale HUD, Repopulate Unit Query HUD, Revamp Hero Grid Layout, Custom Hero Grids, Custom Fonts, Custom Backgrounds, Remove Main Menu Background, User Styles.',
          ],
          [
            'Прямо в игре',
            'Auto Accept Match, Show NetWorth, Stat Site Buttons, OpenDotaGuides Guides.',
          ],
        ],
      },
      {
        k: 'p',
        t: 'Писал их не один человек. Многие сделал сам Egezenn; <a href="https://github.com/robbyz512">robbyz512</a> - большую часть про производительность и звук, <a href="https://github.com/MeGaNeKoS">MeGaNeKoS</a> - принятие матча и нетворс, а Transparent HUD пришёл от ZerdacK из Dota Modding Community. Полная таблица с каждым автором лежит <a href="https://github.com/Egezenn/dota2-minify#special-thanks-to">в его readme</a>.',
      },

      { k: 'h2', t: 'Комьюнити-репозиторий', id: 'community' },
      {
        k: 'p',
        t: 'Minify умеет подключать репозитории модов помимо своего. Тот, что идёт с ним, - <a href="https://github.com/Egezenn/dota2-minify-community">dota2-minify-community</a>, в нём четыре готовых сборки и четыре отдельных мода:',
      },
      {
        k: 'list',
        items: [
          '<b>#&nbsp;Optimizations</b> - все оптимизации Minify одной сборкой.',
          '<b>#&nbsp;Shut It</b> - выключает раздражающие звуки и не только их.',
          '<b>#&nbsp;Flavor</b> - улучшения интерфейса и сторонние интеграции. Части нужны Workshop Tools.',
          '<b>#&nbsp;Old Timer</b> - для тех, кто хочет обратно старые версии некоторых вещей.',
          '<b>As-Is FoW</b> от Egezenn - туман войны без дрожания и с резкими краями.',
          '<b>Default Skins</b> от Lupin - возвращает всем скинам их стандартный вид, можно взять по частям: только партиклы, только скины, только курьеров или только варды.',
          '<b>Simple Dark Terrain</b> от Robby - тёмный ландшафт в сетку.',
          '<b>Settings Copier</b> от prosto saneyk - переносит хоткеи, видео, звук и гайды между аккаунтами Steam и умеет делать это на лету при смене аккаунта.',
        ],
      },
      {
        k: 'p',
        t: 'Второй репозиторий в его списке - <a href="~/docs/catalog/">D2PFX</a>, тот самый каталог, из которого ставит это приложение. Его читают обе программы.',
      },

      { k: 'h2', t: 'Зачем держать обе', id: 'both' },
      {
        k: 'p',
        t: 'Они почти не пересекаются. Это приложение ставит готовую косметику из открытого каталога: сеты героев, ландшафты, курьеров, варды, эффекты, аннонсеров, курсоры. Minify пересобирает куски самой игры: срезает листву и погоду ради кадров, глушит целые категории звуков, двигает HUD, добавляет гайды и кнопки статистики туда, где игра их не даёт. Каталог скинов второго не умеет, а за сетами героев в патчер не ходят.',
      },
      {
        k: 'p',
        t: 'Поэтому честный ответ на «что выбрать» часто такой: не выбирать. Каталог взять отсюда, изменения игры - оттуда.',
      },

      { k: 'h2', t: 'Как они уживаются', id: 'together' },
      {
        k: 'p',
        t: 'Это приложение работает с установленным Minify. Не «должно работать» - оно под это сделано, и всё перечисленное лежит в коде:',
      },
      {
        k: 'list',
        items: [
          '<b>Одна папка, моды обеих программ.</b> Дота монтирует ровно одну языковую папку. Minify выбирает свою и направляет туда Steam; это приложение читает, какую папку игра смонтирует на самом деле, и ставит моды в неё. Уже установленные переезжают сами при следующем запуске.',
          '<b>Его слоты не занимаются.</b> pak65, pak66 и pak67 здесь не раздаются никогда, есть Minify на машине или нет, - чтобы у того, кто поставит его через месяц, не пропал мод.',
          '<b>Его файлы не трогаются.</b> Общий выключатель модов их обходит, а проверка чужих файлов не предлагает их ни забрать, ни удалить. Узнаются они по метаданным, которые Minify кладёт внутрь того, что собирает: это та же проверка, что он делает сам.',
          '<b>Про архив карт спрашивают.</b> Дота читает один <code>maps/dota.vpk</code>, поэтому ландшафт любой из программ - это один и тот же файл. Приложение смотрит, чей файл лежит сейчас, и спрашивает, прежде чем заменить.',
          '<b>Оно говорит, что видит.</b> Если Minify настроен гонять патч перед стартом игры или параметры запуска указывают не туда, «Мои моды» скажут об этом словами, а не оставят тебя с игрой, которая ничего не делает.',
        ],
      },
      {
        k: 'p',
        t: 'В обратную сторону тоже. Приложение оставляет в языковой папке <code>dota2modmanager.json</code> со списком того, что поставило, а Minify с версии v1.14rc7 проверяет принадлежность файла, прежде чем чистить папку карт при удалении, - поэтому поставленный здесь ландшафт это переживает.',
      },

      { k: 'h2', t: 'Где взять', id: 'get' },
      {
        k: 'list',
        items: [
          'Сайт и загрузки: <a href="https://egezenn.github.io/dota2-minify">egezenn.github.io/dota2-minify</a>',
          'Вики, в том числе о том, как написать для него мод: <a href="https://egezenn.github.io/dota2-minify/wiki">вики</a>',
          'Исходники: <a href="https://github.com/Egezenn/dota2-minify">GitHub</a>, зеркало на <a href="https://codeberg.org/egezenn/dota2-minify">Codeberg</a>',
          'Поддержка и комьюнити: <a href="https://discord.com/invite/9867CPv7cy">Discord</a>, <a href="https://t.me/dota2minify">Telegram</a>',
        ],
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          [
            'Ты делаешь Minify или получаешь деньги за то, что отправляешь к нему людей?',
            'Ни то, ни другое. Это проект Egezenn, я к нему не причастен, деньги не ходят ни в одну сторону, и это приложение тоже бесплатное. Мы с ним договорились не мешать друг другу - вот и все отношения.',
          ],
          [
            'Что ставить первым?',
            'Что угодно. Если Minify уже стоит, приложение найдёт выбранную им папку и присоединится. Поставишь Minify потом - нужные ему слоты никто не занял.',
          ],
          [
            'Обе сразу не сломают игру?',
            'Два мода, меняющие один и тот же файл, по-прежнему не могут примениться вместе - ровно как два мода из одного каталога. Это конфликт модов, а не программ, и приложение показывает такие конфликты на экране. <a href="~/docs/vpk/#order">Как работает порядок загрузки</a>.',
          ],
          [
            'Minify тоже умеет ставить моды из каталога?',
            'Да, D2PFX есть в списке его репозиториев. Это приложение добавляет к каталогу просмотр с превью, установку в один клик, порядок загрузки, пресеты и подхват уже лежащих у тебя файлов.',
          ],
          [
            'Ему нужны Workshop Tools. Так и должно быть?',
            'Части его модов - да: они компилируют ресурсы игры, а компилятор приезжает вместе с Dota 2 Workshop Tools из Steam. Модам отсюда они не нужны никогда, потому что приезжают уже собранными.',
          ],
        ],
      },
    ],
  },
  copies: {
    slug: 'copies',
    title: 'Копии Dota 2 Mod Manager: как отличить настоящий',
    h1: 'Копии приложения и как отличить настоящее',
    description:
      'Dota 2 Mod Manager бесплатный, с открытым кодом и без платной версии. Четыре признака копии, которую не стоит запускать, и единственные адреса, которые наши.',
    lead: 'Мы всё чаще находим это приложение под чужими названиями: переименованное, с закрытым кодом, иногда за деньги. Часть таких копий работает на нашем коде, только наше имя из них убрано. Что ещё они делают, проверить нельзя, и они тебе не нужны: оригинал бесплатный.',
    card: 'Платные лаунчеры, переименованные копии, программы с обязательным входом. Четыре признака и адреса, которые правда наши.',
    updated: '2026-10-19',
    blocks: [
      { k: 'h2', t: 'Что гуляет по сети', id: 'what' },
      {
        k: 'p',
        t: 'Лаунчеры, похожие на этот или делающие то же самое, под своим названием, без исходного кода и без слова о том, откуда они взялись. Одни продают подписку, премиум или ключи. Другие требуют войти, прежде чем покажут хоть один мод. А некоторые - это наше приложение с другим именем и без авторов.',
      },
      {
        k: 'p',
        t: 'Оригинал бесплатный, открытый и работает без аккаунта. Значит, каждая такая копия забирает у тебя то, чего оригинал не берёт: деньги, пароль или возможность прочитать, что ты запускаешь.',
      },

      { k: 'h2', t: 'Четыре признака', id: 'signs' },
      {
        k: 'cards',
        items: [
          ['Нет исходного кода', 'Оригинал выходит под GPL-3.0. На этом коде можно строить своё и даже продавать копии, но тот, кто даёт тебе копию, обязан дать и её исходники под той же лицензией. Нет исходников - никто не может прочитать, что делает программа, а её автор нарушает лицензию, на которой она построена.'],
          ['Не сказано, откуда она взялась', 'Та же лицензия требует оставлять в каждой копии имена авторов оригинала. Лаунчер, который называет себя новым и молчит, на чём сделан, скрывает первое, что ты захотел бы знать.'],
          ['Просит денег', 'Dota 2 Mod Manager ни разу ни за что не брал денег. У него нет подписки, премиума, ключей и закрытых модов. Лаунчер, который просит заплатить за ту же работу, продаёт тебе бесплатное.'],
          ['Просит логин или твои данные', 'Поставить мод - значит положить файл в папку с игрой. Для этого не нужны ни логин Steam, ни пароль, ни телефон, ни карта. Единственный вход в оригинале необязательный, проходит на discord.com и только подписывает твоим ником сборку, которой ты делишься.'],
        ],
      },

      { k: 'h2', t: 'Где живёт настоящий', id: 'official' },
      {
        k: 'list',
        items: [
          '<a href="~/">dota2modmanager.com</a> - этот сайт. Кнопки скачивания берут файл прямо со страницы релизов на GitHub.',
          '<a href="https://github.com/dota2modmanager/dota2-mod-manager" rel="noopener">github.com/dota2modmanager/dota2-mod-manager</a> - исходный код и все релизы, каждый собран <a href="https://github.com/dota2modmanager/dota2-mod-manager/actions" rel="noopener">публичным workflow</a>. Старый адрес github.com/TheFleece/dota2-mod-manager ведёт туда же.',
          '<a href="https://gitlab.com/TheFleece/dota2-mod-manager" rel="noopener">gitlab.com/TheFleece/dota2-mod-manager</a> - зеркало того же репозитория.',
          '<a href="https://discord.gg/PBvG8D9MxT" rel="noopener">Сервер в Discord</a>, где отвечают те, кто его делает.',
        ],
      },
      {
        k: 'p',
        t: 'Каталог D2PFX, откуда берутся моды, держит приложение в своём разделе Tools со ссылкой сюда. Всё остальное, что похоже на это приложение, пришло не от нас.',
      },

      { k: 'h2', t: 'Форки, которые этого не скрывают', id: 'forks' },
      {
        k: 'p',
        t: 'Строить своё на этом коде можно, и мы этому рады. Честный форк называет, на чём сделан, выкладывает свои исходники и сохраняет лицензию. Если такой нравится тебе больше, пользуйся им. Четыре признака выше - про копии, которые прячут, откуда взялись.',
      },

      { k: 'h2', t: 'Если уже заплатил или вошёл', id: 'already' },
      {
        k: 'list',
        items: [
          'Смени пароль, который туда вводил, и тот же пароль везде, где он у тебя стоит. Если это был пароль от Steam, смени его в Steam и в настройках Steam Guard выйди на всех остальных устройствах.',
          'Если платил, спроси в банке или платёжном сервисе, как оспорить платёж, и сохрани чек.',
          'Удали копию и поставь оригинал с этого сайта. Он узнает моды, которые уже лежат в папке игры, и возьмёт их под себя. <a href="~/docs/own-mods/#adopt">Как это работает</a>.',
          'Напиши нам, где ты её нашёл, в <a href="https://discord.gg/PBvG8D9MxT" rel="noopener">Discord</a> или на <a href="mailto:hello@dota2modmanager.com">hello@dota2modmanager.com</a>: так мы предупредим следующего.',
        ],
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Есть платная или Pro-версия Dota 2 Mod Manager?', 'Нет. Версия одна, бесплатная, и в ней есть всё. Dota 2 Mod Manager Pro, Premium или VIP - не наш.'],
          ['Лаунчер делает то же самое, но называется иначе. Ему можно верить?', 'Спроси у него исходный код и на чём он сделан. Если он не показывает ни того, ни другого, узнать, что ещё он делает на твоём компьютере, нельзя, а оригинал делает ту же работу бесплатно.'],
          ['Это приложение вообще можно продавать?', 'Лицензия разрешает брать деньги за копию, если покупатель получает все исходники под GPL-3.0 и в копии остаются имена авторов оригинала. Покупать его тебе не нужно: здесь та же программа бесплатно.'],
        ],
      },
    ],
  },

  compare: {
    slug: 'compare',
    title: 'Какой мод-менеджер для Доты 2 выбрать в 2026',
    h1: 'Как выбрать мод-менеджер для Доты 2',
    description:
      'Что проверить до запуска любой программы для модов Дота 2: исходники, кто собрал файл, что она просит, живой ли у неё каталог. С честными ответами про эту программу и про остальные.',
    lead: 'Ты собираешься пустить программу писать в папку с игрой. Пять вопросов решают, разумно ли это, и они одни и те же, что бы ты в итоге ни поставил.',
    card: 'Пять вопросов к любой программе для модов, с ответами про эту и про остальные.',
    blocks: [
      { k: 'h2', t: 'Пять вопросов', id: 'questions' },
      {
        k: 'cards',
        items: [
          ['Можно ли прочитать исходники?', 'Не «исходники по запросу». Репозиторий, который открывается прямо сейчас, с кодом, из которого собран релиз.'],
          ['Кто собрал файл, который ты скачал?', 'У публичного CI остаётся лог, который может открыть кто угодно. У файла, залитого с чьего-то компьютера, остаётся только его слово.'],
          ['Что программа просит?', 'Установщику модов нужна папка игры. Ему не нужен логин Steam, инвентарь или пароль. Всё, что их просит, занимается не установкой файлов.'],
          ['Откуда её моды?', 'Коллекция, вшитая в сборку, стареет вместе со сборкой. Прочитанная по сети растёт без чьих-либо релизов.'],
          ['Что будет, если два мода столкнутся?', 'Два мода с одним файлом не могут примениться оба. Менеджер, который об этом молчит, оставляет тебя выяснять это по карте.'],
        ],
      },

      { k: 'h2', t: 'Ответы про эту', id: 'here' },
      {
        k: 'list',
        items: [
          '<b>Исходники:</b> GPL-3.0, весь репозиторий, каждый релиз с тегом.',
          '<b>Сборка:</b> GitHub Actions, workflow и логи публичные.',
          '<b>Просит:</b> папку игры. Вход через Discord необязателен и нужен только чтобы подписать своим ником сборку, которой делишься.',
          '<b>Моды:</b> читаются вживую из каталога D2PFX, {mods} штук. <a href="~/docs/catalog/">Что это</a>.',
          '<b>Конфликты:</b> называются на экране, порядок загрузки правится там же.',
          '<b>Цена:</b> бесплатно, платного внутри нет, рекламы нет.',
        ],
      },

      { k: 'h2', t: 'Остальные', id: 'others' },
      {
        k: 'p',
        t: 'Так, как о себе говорят они сами: это единственный честный способ поставить чужую программу на свою страницу.',
      },
      {
        k: 'cards',
        items: [
          [
            'DOTA Mods Installer (dota2mods.com)',
            'Самый крупный. На своём сайте заявляет больше 3400 модов и больше 8300 частей модов, только Windows, режим случайного выбора, редактор текстур и частиц, загрузка своих работ. Исходников нет, на сайте есть пожертвование за отключение рекламы. Если решает размер каталога, у него он больше нашего. Чего он не делает, так это не управляет модами: он собирает пак, а положить его в игру, убрать обратно и помнить, что внутри, остаётся твоей заботой.',
          ],
          [
            'd2mm (github.com/SebRut/d2mm)',
            'Открытый код под MIT, и по-настоящему ранний: порядок установки и сборка пакетов. Последний коммит - январь 2015 года, это пять движков Доты назад. С сегодняшней игрой он не работает.',
          ],
          [
            'd2modmanager (github.com/philface)',
            'Открытый код, «без инъекции vpk», последняя правка - февраль 2015 года. Представляет исторический интерес.',
          ],
          [
            'Dota2 Minify (github.com/Egezenn/dota2-minify)',
            'Не альтернатива и не конкурент. Он собирает моды, патча саму игру, а это приложение ставит готовые из каталога, и вместе они работать умеют: приложение ставит моды в ту папку, которую игра смонтирует на самом деле, включая выбранную Minify, держит для него свободными pak65-pak67 и не трогает его файлы. Поставишь обе - каталог берёшь отсюда, изменения игры оттуда. <a href="~/docs/minify/">Что такое Minify и как держать обе</a>.',
          ],
          [
            'Dota 2 SkinChanger (dota2changer.com)',
            'Не программа, а сайт: моды выбираются в браузере, он собирает VPK-пак, а класть его в папку игры ты идёшь сам. Часть коллекции платная. Дальше ничего не обновляется: собранный месяц назад пак таким у тебя и остаётся.',
          ],
          [
            'Скинченджеры и инвентарь-ченджеры (Overplus, MetaSkins и подобные)',
            'Другая категория вещей. Они обещают открыть предметы, которыми ты не владеешь, у них закрытый код и нет публичной сборки, которую можно проверить. Разница простая: эта программа кладёт файл рядом с игрой и умеет его забрать, а они меняют файлы самой игры, и что там ещё затронуто, известно только с их слов.',
          ],
          [
            'Переименованные копии этого приложения',
            'Лаунчеры на коде этого приложения под своим названием, с закрытым кодом и без слова о том, откуда взялись, некоторые за деньги или с обязательным входом. Они не наши, и что ещё они делают, проверить нельзя. <a href="~/docs/copies/">Четыре признака такой копии</a>.',
          ],
          [
            'Umbrella и прочие читы',
            'Это вообще не мод-менеджеры. Там продают скрипты и автоматизацию, которые играют за тебя, и это единственное во всей теме, за что Valve действительно банит аккаунты. Если на одной странице предлагают и моды, и скрипты, эту страницу лучше закрыть.',
          ],
        ],
      },

      { k: 'h2', t: 'В чём эта программа не лучшая', id: 'weak' },
      {
        k: 'list',
        items: [
          'Нет сборки под Mac. Windows и Linux поддерживаются оба и выходят в каждом релизе, а macOS нет: Дота там работает через слой совместимости, и с ним ничего не проверялось.',
          'Каталог меньше самого крупного из существующих. Он отобранный, с превью и открытый - это другой обмен.',
          'Установщик не подписан, поэтому Windows ругается при первом запуске. <a href="~/docs/safe/#smartscreen">Почему и что делать</a>.',
          'Она не редактирует текстуры. Перекрасить мод - работа для инструментов каталога. <a href="~/docs/own-mods/#tools">Вот они</a>.',
        ],
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Можно держать два менеджера сразу?', 'С Minify - да, под это всё и сделано: <a href="~/docs/minify/#together">как они делят игру</a>. С остальными плохо: оба пишут в одну папку, и ни один не знает, что сделал другой. Этот хотя бы замечает чужие файлы и говорит о них, а не затирает.'],
          ['Я уже ставил моды другой программой. Начинать заново?', 'Нет. Укажи эту на папку игры, и она опознает, что там лежит, и возьмёт под управление. <a href="~/docs/own-mods/#adopt">Как это работает</a>.'],
          ['Какой безопаснее?', 'Тот, чей код можно прочитать и чью сборку можно проверить. Это свойство инструмента, а не обещание его автора.'],
        ],
      },
    ],
  },
};

export const moreDocs = { en, ru };
