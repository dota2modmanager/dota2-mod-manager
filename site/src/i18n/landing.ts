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
  /** Three short facts under the hero's buttons. They were one line joined with middle dots. */
  heroTicks: [string, string, string];
  /** The hero's second button, to the catalog. */
  browse: string;
  /** The fourth number: heroes with sets of their own. Carries {word}, agreeing with the count. */
  statHeroes: string;
  statHeroWords: [string, string, string];

  /** Search the catalog from the landing. finderLead carries {mods} and {word}. */
  finderTitle: string;
  finderLead: string;
  finderPlaceholder: string;
  finderAll: string;
  finderEmpty: string;

  /** The screenshots and the clip, as one set of tabs. */
  showTitle: string;
  showVideo: string;

  /** The heroes with the most mods. heroesAll carries {count}. */
  heroesTitle: string;
  heroesLead: string;
  heroesAll: string;

  /** Each step, done by hand and done by the app: [step, by hand, with the app]. */
  compareTitle: string;
  compareLead: string;
  compareCols: [string, string];
  compare: Array<[string, string, string]>;

  /** Under the download, on a phone only: the app is for a computer, and a way to send the link. */
  phoneNote: string;
  phoneShare: string;
  phoneShared: string;

  /** The hunt's reward, said once and then out of the way. */
  huntClose: string;
  huntHint: string;

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
  /** The warning about renamed, closed or paid copies of the app, and its link to the guide. */
  copiesTitle: string;
  copies: string;
  copiesLink: string;

  faqTitle: string;
  faq: Array<[string, string]>;

  ctaTitle: string;
  ctaLead: string;
  ctaMeta: string;
  linkGithub: [string, string];
  linkDiscord: [string, string];
}

export const landing: Record<'en' | 'ru', Landing> = {
  en: {
    heroKicker: 'Free · open source · Windows and Linux',
    heroTitle: 'Dota 2',
    heroTitleAccent: 'Mod Manager',
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
    heroTicks: ['Windows 10/11 and Linux', 'No account', 'Updates itself'],
    browse: 'Browse the catalog',
    statHeroes: '{word} with sets of their own',
    statHeroWords: ['hero', 'heroes', 'heroes'],

    finderTitle: 'Find a mod',
    finderLead: '{mods} {word} in the catalog. Search by name, hero or author, then pick a few and send them to the app as one set.',
    finderPlaceholder: 'Pudge, arcana, river, an author',
    finderAll: 'Open the whole catalog',
    finderEmpty: 'Nothing by that name. Try a hero, or one word from the title.',

    showTitle: 'See it work',
    showVideo: 'Install in one take',

    heroesTitle: 'Pick your hero',
    heroesLead: 'Each hero with a set made for them gets a page with all of it.',
    heroesAll: 'All {count} heroes',

    compareTitle: 'By hand, or with the app',
    compareLead: 'You can do all of it by hand. Each step, both ways:',
    compareCols: ['By hand', 'With the app'],
    compare: [
      ['Finding a mod', 'Forum threads, Discord pins and Drive links, many of them written before the July 2026 patch changed how mods load.', 'One catalog with a preview of every mod, by hero and by kind.'],
      ['Installing it', 'Find the folder Dota mounts for your voice language, rename the .vpk to a free pak number, check the launch options.', 'Press Install. The app picks the folder and the slot.'],
      ['Two mods with the same file', 'One covers the other, and nothing tells you until a match.', 'The app says which one the game loads and lets you swap them.'],
      ['Before a ranked match', 'Move the files out, and remember where to.', 'Switch it off, and back on after.'],
      ['After a Dota patch', 'Check every mod, and put back what the update wiped.', 'The app puts it back, and warns you when something needs you.'],
      ['Sharing your setup', 'A zip and a page of instructions.', 'One link. The other side opens it in the app.'],
      ['Taking it all off', 'Delete the right files and restore the fonts and cursors you backed up, if you did.', 'Remove in My mods. The game is back to how Valve shipped it.'],
    ],

    phoneNote: 'The app is for Windows and Linux. Open this page on your computer, or send yourself the link.',
    phoneShare: 'Send the link',
    phoneShared: 'Link copied',

    huntClose: 'Close',
    huntHint: 'It stays on while you look around. The switch is at the foot of every page.',

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
      ['Make your own with AI', 'Describe the skin to Claude Code or another AI assistant. It reads the game\'s files, builds the effects, models, animations and sounds, checks the result and hands you a VPK to drag in here. One line sets it up. <a href="~/docs/ai-mods/">How to start</a>.'],
    ],

    trustTitle: 'Why you can check this one',
    trustLead: 'It is a program that writes into your game folder, downloaded from the internet. That deserves suspicion. Here is what can be verified instead of trusted.',
    trustFacts: [
      ['Open source, GPL-3.0', 'Every line is in the repository. Not "source available on request" - readable right now.'],
      ['Built by GitHub Actions', 'Releases are built from that source by a public workflow, not uploaded from somebody\'s desktop.'],
      ['{releases} {relWord}, {downloads} {dlWord}', 'It has been in the open since long before you found it, and the whole history is there.'],
      ['No account, nothing about you', 'Signing in is optional and only puts your name on a setup you share. Nothing about you is collected; catalog installs are counted by mod, and that can be switched off.'],
    ],
    smartscreenTitle: 'Windows will warn you, and here is why',
    smartscreen: 'The installer is not signed with a paid certificate, so SmartScreen says "unknown publisher". Click <b>More info</b>, then <b>Run anyway</b>. A certificate costs a few hundred dollars a year, and this is free software; the free programme for open-source projects turned the application down for not being famous enough yet.',

    copiesTitle: 'Copies of this app are going around',
    copies: 'Renamed, closed, sometimes for money: launchers built on this app\'s code that hide where they came from. The real one is free, has no paid version and never asks for your Steam login. Do not trust a launcher that shows no source code, names nobody it is built on, wants a subscription or a payment, or makes you sign in.',
    copiesLink: 'How to tell the real one',

    faqTitle: 'Questions',
    faq: [
      ['Is this a cheat?', 'No. The mods change how things look on your screen only. Nobody else in the match sees them.'],
      ['What kinds of mods are there?', 'Hero skins, terrains, announcers, music, cursors, fonts, item effects, trees, the river, Roshan, mega-kills. All of it lives in the D2PFX catalog, which the community keeps adding to. <a href="~/docs/catalog/">What that catalog is</a>.'],
      ['Will I get banned?', 'Bans are for cheats, and cosmetic mods are not cheats: a mod changes only how the game looks on your screen and gives no advantage. In eight years we know of no ban for one. The app never touches your account, and there is no login unless you want your name on a shared setup. <a href="~/docs/safe/#ban">The longer answer</a>.'],
      ['My antivirus said something.', 'It happens to unsigned installers with no reputation yet. Microsoft reviewed one such report about this app in August 2026 and removed the detection. If yours complains, the file you downloaded is built in the open by GitHub Actions and you can check the workflow that made it. <a href="~/docs/safe/#smartscreen">Why Windows warns you</a>.'],
      ['How do I remove a mod?', 'Delete it in My mods and the game goes back to how it was. Fonts and cursors are restored from the backup the app made before installing. <a href="~/docs/install/#remove">Doing it by hand</a>.'],
      ['Where do the mods come from?', 'The D2PFX catalog: the largest open collection of Dota 2 mods there is, run by h6rd with the community for over a year. The app reads it directly, so new mods appear without an app update. <a href="~/docs/catalog/">About the catalog and its author</a>.'],
      ['Does it work after a Dota update?', 'Yes. After a game patch the app puts back what the update wiped, and warns you when something needs attention. <a href="~/docs/troubleshooting/">What to do when something breaks</a>.'],
      ['Is there a paid version?', 'No. There is one version, it is free, and every feature is in it. Copies of this app go around under other names, some of them sold, closed or asking for a login, and none of them are ours. <a href="~/docs/copies/">How to tell the real one</a>.'],
    ],

    ctaTitle: 'Get it',
    ctaLead: 'Windows 10, 11 or Linux. No account. It updates itself from here on.',
    ctaMeta: 'Free forever. GPL-3.0. Built in the open.',
    linkGithub: ['Read the source', 'Every line, every release, every build log.'],
    linkDiscord: ['Come to Discord', 'Ask, report a bug, show the setup you made.'],
  },

  ru: {
    heroKicker: 'Бесплатно · открытый код · Windows и Linux',
    heroTitle: 'Dota 2',
    heroTitleAccent: 'Mod Manager',
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
    heroTicks: ['Windows 10/11 и Linux', 'Без аккаунта', 'Обновляется само'],
    browse: 'Открыть каталог',
    statHeroes: '{word} со своими сетами',
    statHeroWords: ['герой', 'героя', 'героев'],

    finderTitle: 'Найди мод',
    finderLead: '{mods} {word} в каталоге. Ищи по названию, герою или автору, а потом отметь несколько и отправь их в приложение одним набором.',
    finderPlaceholder: 'Пудж, аркана, река, автор',
    finderAll: 'Весь каталог',
    finderEmpty: 'Ничего с таким названием. Попробуй героя или одно слово из названия.',

    showTitle: 'Как это выглядит',
    showVideo: 'Установка одним дублем',

    heroesTitle: 'Выбери героя',
    heroesLead: 'У каждого героя, для которого кто-то сделал сет, своя страница со всеми его модами.',
    heroesAll: 'Все герои: {count}',

    compareTitle: 'Руками или через приложение',
    compareLead: 'Всё это можно сделать и руками. Каждый шаг, так и так:',
    compareCols: ['Руками', 'В приложении'],
    compare: [
      ['Найти мод', 'Темы на форумах, закрепы в Discord и ссылки на Диск, и многие написаны до июльского патча 2026, который поменял, как грузятся моды.', 'Один каталог с превью каждого мода, по героям и по видам.'],
      ['Поставить', 'Найти папку, которую Дота монтирует для языка озвучки, переименовать .vpk в свободный номер пака, проверить параметры запуска.', 'Нажать «Установить». Папку и слот приложение выберет само.'],
      ['Два мода с одним файлом', 'Один перекрывает другой, и узнаёшь ты об этом уже в катке.', 'Приложение показывает, чей файл грузит игра, и даёт поменять их местами.'],
      ['Перед рейтинговой каткой', 'Вынести файлы и запомнить, куда.', 'Выключить мод, а после катки включить обратно.'],
      ['После патча Доты', 'Проверить каждый мод и вернуть то, что стёрло обновление.', 'Возвращается само, а если нужна твоя помощь, приложение скажет.'],
      ['Поделиться сборкой', 'Архив и страница инструкций.', 'Одна ссылка. На той стороне она откроется в приложении.'],
      ['Убрать всё', 'Удалить нужные файлы и вернуть шрифты и курсоры из копии, если ты её сделал.', '«Удалить» в «Моих модах». Игра снова такая, какой её выпустила Valve.'],
    ],

    phoneNote: 'Приложение для Windows и Linux. Открой сайт на компьютере или скинь себе ссылку.',
    phoneShare: 'Скинуть ссылку',
    phoneShared: 'Ссылка скопирована',

    huntClose: 'Закрыть',
    huntHint: 'Радуга останется, пока ты ходишь по сайту. Выключатель внизу каждой страницы.',

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
      ['Свои моды с помощью ИИ', 'Опиши скин Claude Code или другому ИИ-ассистенту. Он прочитает файлы игры, соберёт эффекты, модели, анимации и звуки, проверит результат и отдаст VPK, который ты перетащишь сюда. Настраивается одной строкой. <a href="~/docs/ai-mods/">Как начать</a>.'],
    ],

    trustTitle: 'Почему это можно проверить',
    trustLead: 'Это программа, которая пишет в папку с игрой и скачана из интернета. Подозрение тут уместно. Вот что можно проверить вместо того, чтобы верить на слово.',
    trustFacts: [
      ['Открытый код, GPL-3.0', 'Каждая строчка лежит в репозитории. Не «исходники по запросу», а прямо сейчас.'],
      ['Собирает GitHub Actions', 'Релизы собираются из этого кода публичным workflow, а не заливаются с чьего-то компьютера.'],
      ['{releases} {relWord}, {downloads} {dlWord}', 'Программа лежит на виду задолго до того, как ты о ней узнал, и вся история там же.'],
      ['Без аккаунта и слежки', 'Вход нужен только чтобы подписать своим ником сборку, которой делишься. Ничего о тебе не собирается; установки из каталога считаются по названию мода, и это выключается.'],
    ],
    smartscreenTitle: 'Windows будет ругаться, и вот почему',
    smartscreen: 'Установщик не подписан платным сертификатом, поэтому SmartScreen пишет «неизвестный издатель». Нажми <b>Подробнее</b>, затем <b>Выполнить в любом случае</b>. Сертификат стоит несколько сотен долларов в год, а программа бесплатная; бесплатная программа подписи для открытых проектов заявку отклонила - проект пока недостаточно известен.',

    copiesTitle: 'По сети ходят копии этого приложения',
    copies: 'Переименованные, с закрытым кодом, иногда платные: лаунчеры на коде этого приложения, которые прячут, откуда взялись. Настоящий бесплатный, платной версии у него нет, и логин Steam он никогда не просит. Не доверяй лаунчеру, который не показывает исходный код, молчит, на чём сделан, просит подписку или деньги или требует войти.',
    copiesLink: 'Как отличить настоящий',

    faqTitle: 'Вопросы про моды в Доте 2',
    faq: [
      ['Это чит?', 'Нет. Моды меняют только картинку у тебя на экране. Соперники и союзники ничего этого не видят.'],
      ['Какие моды бывают?', 'Скины на героев, ландшафты (в народе терраины), комментаторы, музыка, курсоры, шрифты, эффекты предметов, деревья, река, Рошан, мега-киллы. Всё это лежит в каталоге D2PFX, и его пополняет сообщество. <a href="~/docs/catalog/">Что это за каталог</a>.'],
      ['Забанят?', 'Банят за читы, а косметические моды не читы: мод меняет только то, как игра выглядит на твоём экране, и не даёт преимущества. За восемь лет мы не знаем ни одного бана за них. Приложение не трогает твой аккаунт, вход нужен только если хочешь подписать свою сборку ником. <a href="~/docs/safe/#ban">Развёрнутый ответ</a>.'],
      ['Антивирус что-то сказал.', 'Так бывает с неподписанными установщиками без репутации. Microsoft разобрала одно такое обращение по этой программе в августе 2026 и сняла детект. Если ругается твой - файл собран на виду в GitHub Actions, и workflow, который его собрал, можно открыть и прочитать. <a href="~/docs/safe/#smartscreen">Почему ругается Windows</a>.'],
      ['Как убрать мод?', 'Кнопка «Удалить» в «Моих модах» возвращает игру к исходному виду. Шрифты и курсоры восстанавливаются из копии, которую приложение сделало до установки. <a href="~/docs/install/#remove">Как это делается руками</a>.'],
      ['Откуда моды?', 'Каталог D2PFX: самая большая открытая коллекция модов для Доты 2, её больше года ведёт h6rd вместе с сообществом. Приложение читает каталог напрямую, поэтому новые моды появляются без обновления программы. <a href="~/docs/catalog/">Про каталог и его автора</a>.'],
      ['А после патча доты работает?', 'Да. После обновления игры приложение возвращает на место то, что патч стёр, и предупреждает, если что-то требует внимания. <a href="~/docs/troubleshooting/">Что делать, если что-то сломалось</a>.'],
      ['Есть платная версия?', 'Нет. Версия одна, бесплатная, и в ней есть всё. Под чужими названиями ходят копии этого приложения, платные, с закрытым кодом или с обязательным входом, и ни одна из них не наша. <a href="~/docs/copies/">Как отличить настоящий</a>.'],
    ],

    ctaTitle: 'Скачать мод-менеджер для Доты 2',
    ctaLead: 'Windows 10, 11 или Linux. Без аккаунта. Дальше обновляется само.',
    ctaMeta: 'Бесплатно навсегда. GPL-3.0. Собирается на виду.',
    linkGithub: ['Читать исходники', 'Каждая строчка, каждый релиз, каждый лог сборки.'],
    linkDiscord: ['Зайти в Discord', 'Спросить, сообщить о баге, показать свою сборку.'],
  },
};
