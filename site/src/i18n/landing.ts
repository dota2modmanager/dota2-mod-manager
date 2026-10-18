/**
 * The landing's own words, in both languages.
 *
 * Most of this is carried over from the site the project already had rather than written
 * fresh: that copy has been in front of users for months, and rewriting working text to make
 * it new is how a page loses the phrasing that earned its trust. What changed is what became
 * untrue - the old footer promised a code-signing certificate from an application that has
 * since been turned down.
 *
 * No numbers live here any more. They were typed in on 2026-08-07 and had all drifted three
 * days later, so the build counts them instead: see src/lib/stats.ts. What stays here is the
 * words around them, including the plural forms, because Russian needs the noun to agree with
 * a number nobody knows in advance.
 *
 * Stars and forks are deliberately absent - there are ten of them, and a number that small
 * argues against the thing it is meant to support.
 */
export interface Landing {
  heroKicker: string;
  heroTitle: string;
  heroTitleAccent: string;
  /** Carries {mods} and {word}: the count and the noun that has to agree with it. */
  heroLead: string;
  download: string;
  source: string;
  heroMeta: string;
  /** The download button and the three files behind it. */
  dlInstaller: { title: string; note: string };
  dlPortable: { title: string; note: string };
  dlLinux: { title: string; note: string };
  dlAll: string;
  /** Under each number. {word} is filled from statWords so the noun matches the count. */
  statLabels: [string, string, string, string];
  /** Singular / few / many, for the first three tiles. English repeats itself, Russian does not. */
  statWords: [[string, string, string], [string, string, string], [string, string, string]];
  latest: string;

  filmTitle: string;
  filmCaption: string;
  filmPlay: string;

  /** The walkthrough somebody else filmed, and the credit that goes with it. */
  creatorTitle: string;
  creatorKicker: string;
  creatorName: string;
  creatorLead: string;
  creatorWatch: string;
  creatorChannel: string;
  creatorAlt: string;

  /** The interactive panel: pak order, and who wins a shared file. */
  standTitle: string;
  standLead: string;
  standSlots: string;
  standEmpty: string;
  standWins: string;
  standCovered: string;
  standHint: string;
  standMove: string;

  shotsTitle: string;
  shotCatalog: string;
  shotLibrary: string;
  shotHeroes: string;
  shotLabels: [string, string, string];
  /** Accessible name for the tab list that switches between the screenshots. */
  shotsTablist: string;

  huntComplete: string;
  /** Shown to somebody who arrived on a link from a person who found all eight. */
  huntShared: string;

  whatTitle: string;
  cards: Array<[string, string]>;

  trustTitle: string;
  trustLead: string;
  /** One of these carries {releases}/{downloads} and their agreeing nouns, filled from stats. */
  trustFacts: Array<[string, string]>;
  smartscreenTitle: string;
  smartscreen: string;

  faqTitle: string;
  faq: Array<[string, string]>;

  ctaTitle: string;
  ctaLead: string;
  ctaMeta: string;
  /** The scrolling band above the finale: [catalog category id, what to call it]. The counts
      come from the catalog itself, so this list only has to say which ones to show. */
  marquee: Array<[string, string]>;
  linkGithub: [string, string];
  linkDiscord: [string, string];
}

export const landing: Record<'en' | 'ru', Landing> = {
  en: {
    heroKicker: 'Free · open source · Windows and Linux',
    heroTitle: 'DOTA 2 MOD',
    heroTitleAccent: 'MANAGER',
    heroLead: 'A mod manager for Dota 2: {mods} {word} from the D2PFX catalog in one place. One click to install, one to take back. Plus the cosmetics your account already owns and setups you can send as a link.',
    download: 'Download',
    dlInstaller: { title: 'Windows installer', note: 'Installs, adds a shortcut, updates itself' },
    dlPortable: { title: 'Windows portable', note: 'One file, runs from anywhere, nothing installed' },
    dlLinux: { title: 'Linux AppImage', note: 'chmod +x and run it' },
    dlAll: 'All files, checksums and release notes on GitHub',
    source: 'Source code',
    heroMeta: 'Windows 10/11 and Linux · no account · updates itself',
    statLabels: ['{word} in the catalog', '{word}', '{word}', 'free'],
    statWords: [
      ['mod', 'mods', 'mods'],
      ['download', 'downloads', 'downloads'],
      ['release', 'releases', 'releases'],
    ],
    latest: 'latest',

    filmTitle: 'One take, start to finish',
    filmCaption: 'Find a hero, take a set, take another, install both. No cuts and no speed-up.',
    filmPlay: 'Play the clip',

    creatorTitle: 'Someone filmed a walkthrough',
    creatorKicker: 'YouTube · hanta',
    creatorName: 'Как ставить любые моды, шмотки и карты в Dota 2 еще легче? | Dota 2 Mod Manager',
    creatorLead: 'hanta goes through the whole thing on camera: where the mods come from, how to put cosmetics and terrains in, what to click when the game will not take them. The video is in Russian. Thanks to him for making it.',
    creatorWatch: 'Watch on YouTube',
    creatorChannel: "hanta's channel",
    creatorAlt: "Thumbnail of hanta's video about Dota 2 Mod Manager, with the app's mod catalog behind it",

    standTitle: 'Try the part people get wrong',
    standLead: 'Two mods carrying the same file cannot both win. The game loads the one in the lower pak slot. Switch these on and off, drag them into another order, and watch which one the game takes.',
    standSlots: 'In the game folder',
    standEmpty: 'Nothing switched on. The game looks exactly as Valve shipped it.',
    standWins: 'the game loads it from',
    standCovered: 'covered',
    standHint: 'The app shows you this for your real mods, and lets you change the order from the same screen.',
    standMove: 'Drag to reorder, or use the arrow keys',

    shotsTitle: 'What it looks like',
    shotCatalog: 'The catalog: every mod in the community collection, sorted the way its authors sorted it.',
    shotLibrary: 'Your mods: switch one off before a match, back on after. The app says when one mod is covering another.',
    shotHeroes: 'Everything for one hero in one place, with the tags that say what a mod actually changes.',
    shotLabels: ['Catalog', 'Heroes', 'My mods'],
    shotsTablist: 'Screens of the app',

    huntComplete: 'You found all of them. The site is wearing every palette at once.',
    huntShared: 'Somebody found all eight. Yours are still hidden.',

    whatTitle: 'What you get',
    cards: [
      ['One click in, one click out', 'The app downloads the mod, puts it in a free pak slot and cleans up after itself. No copying files, no renaming pak51_dir.vpk by hand.'],
      ['Switch off, do not delete', 'Turn a mod off before a match and back on after. Your library stays, the game folder stays clean.'],
      ['Cosmetics you already own', 'Weather, couriers, wards, loading screens, announcers, mega-kills. Read from the game\'s own item table, so anything Valve adds shows up by itself. Editing that table is the one thing here that changes a game file instead of adding a VPK beside it, so it waits until you turn safe mode off. <a href="~/docs/safe/">What you are turning off</a>.'],
      ['It tells you when mods collide', 'Two mods that carry the same file cannot both win. The app says which one the game is loading and lets you swap the order.'],
      ['Setups by link', 'Save the mods you run as a preset and send it in one message. The other side opens it and gets the same look.'],
      ['It survives Dota patches', 'After a game update the app puts back what the patch wiped, and it writes to the game folder as one transaction - if anything fails, everything goes back.'],
      ['It works with Dota2 Minify', 'Run both on the same game. This app installs into whichever folder Minify pointed the game at, keeps the pak slots Minify writes free, and never touches its files. <a href="~/docs/minify/">What Minify is, and running the two together</a>.'],
    ],

    trustTitle: 'Why you can check this one',
    trustLead: 'It is a program that writes into your game folder, downloaded from the internet. That deserves suspicion. Here is what can be verified instead of trusted.',
    trustFacts: [
      ['Open source, GPL-3.0', 'Every line is in the repository. Not "source available on request" - readable right now.'],
      ['Built by GitHub Actions', 'Releases are built from that source by a public workflow, not uploaded from somebody\'s desktop.'],
      ['{releases} {relWord}, {downloads} {dlWord}', 'It has been in the open since long before you found it, and the whole history is there.'],
      ['No account, no telemetry', 'Signing in is optional and only puts your name on a setup you share. Nothing is collected.'],
    ],
    smartscreenTitle: 'Windows will warn you, and here is why',
    smartscreen: 'The installer is not signed with a paid certificate, so SmartScreen says "unknown publisher". Click <b>More info</b>, then <b>Run anyway</b>. A certificate costs a few hundred dollars a year, and this is free software; the free programme for open-source projects turned the application down for not being famous enough yet.',

    faqTitle: 'Questions',
    faq: [
      ['Is this a cheat?', 'No. The mods change how things look on your screen only. Nobody else in the match sees them.'],
      ['What kinds of mods are there?', 'Hero skins, terrains, announcers, music, cursors, fonts, item effects, trees, the river, Roshan, mega-kills. All of it lives in the D2PFX catalog, which the community keeps adding to. <a href="~/docs/catalog/">What that catalog is</a>.'],
      ['Will I get banned?', 'Bans are for cheats, and cosmetic mods are not cheats: a mod changes only how the game looks on your screen and gives no advantage. In eight years we know of no ban for one. The app never touches your account, and there is no login unless you want your name on a shared setup. <a href="~/docs/safe/#ban">The longer answer</a>.'],
      ['My antivirus said something.', 'It happens to unsigned installers with no reputation yet. Microsoft reviewed one such report about this app in August 2026 and removed the detection. If yours complains, the file you downloaded is built in the open by GitHub Actions and you can check the workflow that made it. <a href="~/docs/safe/#smartscreen">Why Windows warns you</a>.'],
      ['How do I remove a mod?', 'Delete it in My mods and the game goes back to how it was. Fonts and cursors are restored from the backup the app made before installing. <a href="~/docs/install/#remove">Doing it by hand</a>.'],
      ['Where do the mods come from?', 'The D2PFX catalog: the largest open collection of Dota 2 mods there is, run by h6rd with the community for over a year. The app reads it directly, so new mods appear without an app update. <a href="~/docs/catalog/">About the catalog and its author</a>.'],
      ['Does it work after a Dota update?', 'Yes. After a game patch the app puts back what the update wiped, and warns you when something needs attention. <a href="~/docs/troubleshooting/">What to do when something breaks</a>.'],
    ],

    ctaTitle: 'Get it',
    ctaLead: 'Windows 10, 11 or Linux. No account. It updates itself from here on.',
    ctaMeta: 'Free forever. GPL-3.0. Built in the open.',
    marquee: [
      ['heroes', 'Heroes'], ['hero-items', 'Hero items'], ['backgrounds', 'Backgrounds'],
      ['mega-kill', 'Mega-kills'], ['cursors', 'Cursors'], ['shaders', 'Shaders'],
      ['hero-sounds', 'Hero sounds'], ['couriers', 'Couriers'], ['item-effects', 'Item effects'],
      ['terrains', 'Terrains'], ['river', 'River'], ['trees', 'Trees'],
      ['emblems', 'Emblems'], ['music', 'Music'], ['sounds', 'Sounds'],
      ['roshan', 'Roshan'], ['fonts', 'Fonts'], ['announcers', 'Announcers'],
    ],
    linkGithub: ['Read the source', 'Every line, every release, every build log.'],
    linkDiscord: ['Come to Discord', 'Ask, report a bug, show the setup you made.'],
  },

  ru: {
    heroKicker: 'Бесплатно · открытый код · Windows и Linux',
    heroTitle: 'DOTA 2 MOD',
    heroTitleAccent: 'MANAGER',
    heroLead: 'Мод-менеджер для Доты 2: {mods} {word} из каталога D2PFX в одном месте. Один клик поставить, один - убрать. Плюс косметика, которая у тебя и так есть, и сборки, которые отправляются ссылкой.',
    download: 'Скачать',
    dlInstaller: { title: 'Windows, установщик', note: 'Поставит, сделает ярлык, обновляется сам' },
    dlPortable: { title: 'Windows, портативная', note: 'Один файл, запускается откуда угодно' },
    dlLinux: { title: 'Linux, AppImage', note: 'chmod +x и запускай' },
    dlAll: 'Все файлы, хеши и список изменений на GitHub',
    source: 'Исходный код',
    heroMeta: 'Windows 10/11 и Linux · без аккаунта · обновляется само',
    statLabels: ['{word} в каталоге', '{word}', '{word}', 'бесплатно'],
    statWords: [
      ['мод', 'мода', 'модов'],
      ['скачивание', 'скачивания', 'скачиваний'],
      ['релиз', 'релиза', 'релизов'],
    ],
    latest: 'последняя',

    filmTitle: 'Как ставится мод на Доту 2: один дубль, от начала до конца',
    filmCaption: 'Находим героя, берём сет, берём второй, ставим оба. Без склеек и без ускорения.',
    filmPlay: 'Включить ролик',

    creatorTitle: 'Про менеджер сняли видео',
    creatorKicker: 'YouTube · hanta',
    creatorName: 'Как ставить любые моды, шмотки и карты в Dota 2 еще легче? | Dota 2 Mod Manager',
    creatorLead: 'hanta показал весь путь на камеру: откуда берутся моды, как поставить шмотки и ландшафты, куда нажимать, если игра их не берёт. Читать не обязательно, можно просто посмотреть. Спасибо ему за ролик.',
    creatorWatch: 'Смотреть на YouTube',
    creatorChannel: 'Канал hanta',
    creatorAlt: 'Превью ролика hanta про Dota 2 Mod Manager, за ним каталог модов в окне приложения',

    standTitle: 'Порядок модов: потрогай то, на чём все спотыкаются',
    standLead: 'Два мода с одним и тем же файлом не могут выиграть оба. Игра грузит тот, что лежит в паке с меньшим номером. Повключай их, перетащи в другом порядке и посмотри, чей файл возьмёт игра.',
    standSlots: 'В папке игры',
    standEmpty: 'Ничего не включено. Игра ровно такая, какой её выпустила Valve.',
    standWins: 'игра берёт его из',
    standCovered: 'перекрыт',
    standHint: 'Приложение показывает это же для твоих настоящих модов и там же даёт поменять порядок.',
    standMove: 'Перетащи или двигай стрелками',

    shotsTitle: 'Как выглядит менеджер модов для Доты 2',
    shotCatalog: 'Каталог: все моды и скины из коллекции D2PFX, в том порядке, в котором это разложили её авторы.',
    shotLibrary: 'Мои моды: выключил перед каткой, включил после. Приложение говорит, когда один мод перекрывает другой.',
    shotHeroes: 'Все скины на одного героя Доты 2 в одном месте, с чипами, которые говорят, что мод меняет на самом деле.',
    shotLabels: ['Каталог', 'Герои', 'Мои моды'],
    shotsTablist: 'Экраны приложения',

    huntComplete: 'Ты нашёл всех. Сайт надел все палитры разом.',
    huntShared: 'Кто-то нашёл всех восьмерых. У тебя они ещё спрятаны.',

    whatTitle: 'Что умеет мод-менеджер',
    cards: [
      ['Поставил и убрал в один клик', 'Приложение само качает мод, кладёт его в свободный слот и убирает за собой. Не надо копировать файлы и переименовывать pak51_dir.vpk руками.'],
      ['Выключить, а не удалять', 'Выключи мод перед каткой и включи обратно после. Библиотека остаётся, папка игры чистая.'],
      ['Косметика, которая уже твоя', 'Погода, курьеры, варды, экраны загрузки, комментаторы, мега-киллы. Читается из таблицы предметов самой игры, поэтому новое от Valve появляется само. Правка этой таблицы - единственное здесь, что меняет файл игры, а не кладёт VPK рядом, поэтому она ждёт, пока ты не выключишь безопасный режим. <a href="~/docs/safe/">Что именно выключаешь</a>.'],
      ['Говорит, когда моды спорят', 'Два мода с одним и тем же файлом не могут выиграть оба. Приложение показывает, чей файл грузит игра, и даёт поменять порядок.'],
      ['Сборки ссылкой', 'Сохрани набор включённых модов пресетом и отправь одним сообщением. На той стороне откроется то же самое.'],
      ['Переживает патчи Доты', 'После обновления игры приложение возвращает на место то, что патч стёр, а в папку игры пишет одной транзакцией: если что-то сорвётся, всё вернётся как было.'],
      ['Работает с Dota2 Minify', 'Держи обе на одной игре. Приложение ставит моды в ту папку, на которую Minify направил игру, его слоты паков не занимает, его файлы не трогает. <a href="~/docs/minify/">Что такое Minify и как держать обе</a>.'],
    ],

    trustTitle: 'Почему это можно проверить',
    trustLead: 'Это программа, которая пишет в папку с игрой и скачана из интернета. Подозрение тут уместно. Вот что можно проверить вместо того, чтобы верить на слово.',
    trustFacts: [
      ['Открытый код, GPL-3.0', 'Каждая строчка лежит в репозитории. Не «исходники по запросу», а прямо сейчас.'],
      ['Собирает GitHub Actions', 'Релизы собираются из этого кода публичным workflow, а не заливаются с чьего-то компьютера.'],
      ['{releases} {relWord}, {downloads} {dlWord}', 'Программа лежит на виду задолго до того, как ты о ней узнал, и вся история там же.'],
      ['Без аккаунта и без телеметрии', 'Вход нужен только чтобы подписать своим ником сборку, которой делишься. Ничего не собирается.'],
    ],
    smartscreenTitle: 'Windows будет ругаться, и вот почему',
    smartscreen: 'Установщик не подписан платным сертификатом, поэтому SmartScreen пишет «неизвестный издатель». Нажми <b>Подробнее</b>, затем <b>Выполнить в любом случае</b>. Сертификат стоит несколько сотен долларов в год, а программа бесплатная; бесплатная программа подписи для открытых проектов заявку отклонила - проект пока недостаточно известен.',

    faqTitle: 'Вопросы про моды в Доте 2',
    faq: [
      ['Это чит?', 'Нет. Моды меняют только картинку у тебя на экране. Соперники и союзники ничего этого не видят.'],
      ['Какие моды бывают?', 'Скины на героев, ландшафты (в народе терраины), комментаторы, музыка, курсоры, шрифты, эффекты предметов, деревья, река, Рошан, мега-киллы. Всё это лежит в каталоге D2PFX, и его пополняет сообщество. <a href="~/docs/catalog/">Что это за каталог</a>.'],
      ['Забанят?', 'Банят за читы, а косметические моды не читы: мод меняет только то, как игра выглядит на твоём экране, и не даёт преимущества. За восемь лет мы не знаем ни одного бана за них. Приложение не трогает твой аккаунт, вход нужен только если хочешь подписать свою сборку ником. <a href="~/docs/safe/#ban">Развёрнутый ответ</a>.'],
      ['Антивирус что-то сказал.', 'Так бывает с неподписанными установщиками без репутации. Microsoft разобрала одно такое обращение по этой программе в августе 2026 и сняла детект. Если ругается твой - файл собран на виду в GitHub Actions, и workflow, который его собрал, можно открыть и прочитать. <a href="~/docs/safe/#smartscreen">Почему ругается Windows</a>.'],
      ['Как убрать мод?', 'Кнопка «Удалить» в «Моих модах» возвращает игру к исходному виду. Шрифты и курсоры восстанавливаются из копии, которую приложение сделало до установки. <a href="~/docs/install/#remove">Как это делается руками</a>.'],
      ['Откуда моды?', 'Каталог D2PFX: самая большая открытая коллекция модов для Доты 2, её больше года ведёт h6rd вместе с сообществом. Приложение читает каталог напрямую, поэтому новые моды появляются без обновления программы. <a href="~/docs/catalog/">Про каталог и его автора</a>.'],
      ['А после патча доты работает?', 'Да. После обновления игры приложение возвращает на место то, что патч стёр, и предупреждает, если что-то требует внимания. <a href="~/docs/troubleshooting/">Что делать, если что-то сломалось</a>.'],
    ],

    ctaTitle: 'Скачать мод-менеджер для Доты 2',
    ctaLead: 'Windows 10, 11 или Linux. Без аккаунта. Дальше обновляется само.',
    ctaMeta: 'Бесплатно навсегда. GPL-3.0. Собирается на виду.',
    marquee: [
      ['heroes', 'Герои'], ['hero-items', 'Предметы героев'], ['backgrounds', 'Фоны меню'],
      ['mega-kill', 'Мега-киллы'], ['cursors', 'Курсоры'], ['shaders', 'Шейдеры'],
      ['hero-sounds', 'Звуки героев'], ['couriers', 'Курьеры'], ['item-effects', 'Эффекты предметов'],
      ['terrains', 'Ландшафты'], ['river', 'Река'], ['trees', 'Деревья'],
      ['emblems', 'Эмблемы'], ['music', 'Музыка'], ['sounds', 'Звуки'],
      ['roshan', 'Рошан'], ['fonts', 'Шрифты'], ['announcers', 'Комментаторы'],
    ],
    linkGithub: ['Читать исходники', 'Каждая строчка, каждый релиз, каждый лог сборки.'],
    linkDiscord: ['Зайти в Discord', 'Спросить, сообщить о баге, показать свою сборку.'],
  },
};
