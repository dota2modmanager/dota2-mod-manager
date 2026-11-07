/**
 * The Ulibka Launcher page, in both languages.
 *
 * People search for that launcher by name, and the page they find should say what it does on a
 * computer. Everything here is something a reader can check without us: the SHA-256 of each file,
 * the launcher's own FAQ, the files it leaves on disk and the registry values it writes. We looked
 * at it in Windows Sandbox in November 2026, without a Steam account, and we say in the first
 * paragraph that we make a competing app. No code, no binaries and no download links: the hashes
 * are enough to find the files on VirusTotal.
 *
 * If the launcher changes, the hashes stop matching and the page says when it was checked.
 */
import type { Doc } from './docs.ts';

type Slug = 'ulibka-launcher';

const HASHES = [
  ['UlibkaLoader.exe', '25168022422897bc09cc9ec8a595c2af99e73d500507425f815457d6b83dce94'],
  ['dota_overlay.dll', 'db963df0ed6c4d68aae20306599771ee4eaadbfa32b9f4c58409f781b819cfa7'],
  ['injector.exe', 'f4824cf7f59776e415fa40356e8191e16e190b0c00afcfa062ae207cd4d0bdd5'],
];
const hashRows = HASHES.map(([file, sha]) => [`<code>${file}</code>`, `<code>${sha}</code>`]);

const en: Record<Slug, Doc> = {
  'ulibka-launcher': {
    slug: 'ulibka-launcher',
    title: 'Ulibka Launcher: what it installs and what it risks for your account',
    h1: 'Ulibka Launcher, taken apart',
    description:
      'What Ulibka Launcher does after you install it: injects a DLL into Dota 2, fakes your rank and MMR, changes your MAC address and MachineGuid, and wipes traces from Steam and Windows. With file hashes so you can check it yourself.',
    lead: 'We looked at Ulibka Launcher in an isolated Windows Sandbox, without a Steam account of our own. We make Dota 2 Mod Manager, so we compete with it. That is why everything below is something you can check without us.',
    card: 'A skin changer on the outside, a cheat with a ban-evasion spoofer inside. What it does, with hashes to check.',
    updated: '2026-11-07',
    blocks: [
      { k: 'h2', t: 'In short', id: 'short' },
      {
        k: 'p',
        t: 'Ulibka Launcher sells itself as a skin changer with custom hero sets. Once Dota starts, it loads its own library into the game, changes what the game receives from Valve\'s servers and hides your computer from a ban. Its own FAQ says this breaks Valve\'s rules and that the risk is yours.',
      },

      { k: 'h2', t: 'What it does', id: 'what' },
      {
        k: 'list',
        items: [
          '<b>Injects a DLL into the game.</b> The launcher downloads <code>dota_overlay.dll</code> and <code>injector.exe</code> and loads the library into <code>dota2.exe</code> after it starts. Anti-cheat looks for exactly this.',
          '<b>Fakes messages from the game coordinator.</b> The library feeds the game messages Valve never sent: items you do not own, another medal, stars and MMR, Dota Plus.',
          '<b>Gives you an edge in a match.</b> The launcher\'s settings have switches for seeing units in the fog of war and for highlighting them. The library adds a longer camera, heroes on the map with respawn timers and auto-accept. A cosmetic mod does none of this.',
          '<b>Changes your hardware in Steam\'s eyes.</b> Its spoofer rewrites the MAC address of your network card (<code>NetworkAddress</code> in the registry, then restarts the adapter) and the Windows <code>MachineGuid</code>. That is what a banned account needs to get back in from the same computer.',
          '<b>Wipes traces.</b> It deletes Steam\'s logs, dumps and caches, its <code>MachineHash</code> and <code>InstallGUID</code>, the Prefetch files for <code>dota2.exe</code> and <code>steam.exe</code>, and Windows crash dumps.',
          '<b>Makes your connection worse.</b> It edits <code>machine_convars.vcfg</code>: <code>cl_updaterate</code> from 60 to 30, <code>rate</code> from 786432 to 80000.',
          '<b>Reports to its own server.</b> Once a minute: an install ID, the file versions, whether you are in a game and whether the overlay runs. Sign-in is tied to your hardware ID (taken from <code>MachineGuid</code>) and a Telegram account, and the features unlock only after you join their channels.',
          '<b>Reads your Steam sign-in file.</b> <code>loginusers.vdf</code>: your profile name and auto sign-in. It also rewrites Dota\'s launch options in <code>localconfig.vdf</code>.',
        ],
      },

      { k: 'h2', t: 'Where its mods come from', id: 'mods' },
      {
        k: 'p',
        t: 'The sets in the launcher are the open D2PFX catalog: 737 hero mods for 125 heroes when we looked, downloaded from D2PFX\'s own mirrors. The same mods install for free and with no cheat from any manager that works with files rather than with the game\'s memory. <a href="~/catalog/">This one, for example</a>.',
      },

      { k: 'h2', t: 'Check it yourself', id: 'hashes' },
      { k: 'table', head: ['File', 'SHA-256'], rows: hashRows },
      {
        k: 'p',
        t: 'Paste a hash into the search on <a href="https://www.virustotal.com/" rel="noopener">virustotal.com</a> as it is. On 2 November 2026, 30 engines out of 66 flagged the loader.',
      },

      { k: 'h2', t: 'If you already installed it', id: 'remove' },
      {
        k: 'steps',
        items: [
          ['Remove its folders', 'Close the launcher and delete <code>%LOCALAPPDATA%\\Ulibka</code> and <code>%APPDATA%\\Ulibka</code>.'],
          ['Verify the game files', 'In Steam: Dota 2, Properties, Installed files, Verify integrity. That removes its files from <code>game\\bin\\win64</code>.'],
          ['Check the launch options', 'The launcher writes its own into Dota\'s launch options. Clear what you did not put there.'],
          ['Undo the spoofer', 'If you turned it on, your MAC address and <code>MachineGuid</code> are still changed. The MAC goes back in the adapter\'s properties: Advanced, Network Address, Not Present.'],
          ['Leave their Telegram', 'Unsubscribe from the bot and the channels if you do not want them.'],
        ],
      },

      { k: 'h2', t: 'Questions', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Will I get banned for Ulibka Launcher?', 'We do not know when Valve will start banning for this library. We know that injecting code into the game and faking game coordinator messages is what Valve bans for: in 2023 it banned over 40,000 accounts for a cheat that read the client\'s data.'],
          ['How is this different from mods?', 'A mod is a file the game reads by itself, like its own translation. It does not touch the game\'s memory or your account, and you remove it in one click. <a href="~/docs/safe/">Are mods safe</a>.'],
          ['Is Ulibka Launcher connected to Dota 2 Mod Manager?', 'No. Different people, different code, and no deal of any kind between us.'],
          ['Why write this when you compete with it?', 'Because people find it by searching and do not know what it does. And because we compete with it, everything above is checkable without us.'],
        ],
      },
    ],
  },
};

const ru: Record<Slug, Doc> = {
  'ulibka-launcher': {
    slug: 'ulibka-launcher',
    title: 'Ulibka Launcher: что он ставит на компьютер и чем грозит аккаунту',
    h1: 'Ulibka Launcher: разбор',
    description:
      'Что делает Ulibka Launcher после установки: внедряет DLL в Доту, подменяет медаль и MMR, меняет MAC-адрес и MachineGuid, чистит следы в Steam и Windows. С хешами файлов, чтобы проверить самому.',
    lead: 'Мы разобрали Ulibka Launcher в изолированной Windows Sandbox, без своего аккаунта Steam. Сразу оговорка: мы делаем Dota 2 Mod Manager, то есть мы конкуренты. Поэтому ниже только то, что ты можешь проверить сам.',
    card: 'Снаружи скинченджер, внутри чит со спуфером от бана. Что он делает, с хешами для проверки.',
    updated: '2026-11-07',
    blocks: [
      { k: 'h2', t: 'Коротко', id: 'short' },
      {
        k: 'p',
        t: 'Ulibka Launcher продаёт себя как скинченджер и набор кастомных сетов. На деле после запуска Доты он загружает в её процесс свою библиотеку, меняет то, что игра получает от серверов Valve, и прячет компьютер от бана. В своём FAQ авторы сами пишут, что это нарушает правила Valve и риск на тебе.',
      },

      { k: 'h2', t: 'Что он делает', id: 'what' },
      {
        k: 'list',
        items: [
          '<b>Внедряет DLL в процесс игры.</b> Лаунчер скачивает <code>dota_overlay.dll</code> и <code>injector.exe</code> и после старта <code>dota2.exe</code> загружает библиотеку внутрь игры. Античит ищет именно такое.',
          '<b>Подделывает ответы координатора игры.</b> Библиотека подсовывает игре сообщения, которых Valve не отправляла: предметы, которых у тебя нет, другую медаль, звёзды и MMR, Dota Plus.',
          '<b>Даёт преимущество в матче.</b> В настройках лаунчера есть переключатели видимости в тумане войны и подсветки юнитов, в библиотеке есть отдалённая камера, герои на карте с таймерами возрождения и автопринятие игры. Косметический мод не умеет ничего из этого.',
          '<b>Меняет железо в глазах Steam.</b> Спуфер переписывает MAC-адрес сетевой карты (<code>NetworkAddress</code> в реестре, потом перезапуск адаптера) и <code>MachineGuid</code> Windows. Это нужно забаненному аккаунту, чтобы снова зайти с того же компьютера.',
          '<b>Чистит следы.</b> Удаляет логи, дампы и кеши Steam, его <code>MachineHash</code> и <code>InstallGUID</code>, файлы Prefetch для <code>dota2.exe</code> и <code>steam.exe</code>, дампы падений Windows.',
          '<b>Ухудшает сеть в игре.</b> Правит <code>machine_convars.vcfg</code>: <code>cl_updaterate</code> с 60 на 30, <code>rate</code> с 786432 на 80000.',
          '<b>Отправляет данные на свой сервер.</b> Раз в минуту: номер установки, версии файлов, в игре ли ты и работает ли оверлей. Вход привязан к номеру железа (из <code>MachineGuid</code>) и к Telegram-аккаунту, функции открываются только после подписки на их каналы.',
          '<b>Читает файл входа Steam.</b> <code>loginusers.vdf</code>: имя профиля и автовход. И переписывает параметры запуска Доты в <code>localconfig.vdf</code>.',
        ],
      },

      { k: 'h2', t: 'Откуда в нём моды', id: 'mods' },
      {
        k: 'p',
        t: 'Сеты в лаунчере это открытый каталог D2PFX: 737 модов на 125 героев, когда мы смотрели, скачиваются с зеркал самого D2PFX. Эти же моды бесплатно и без чита ставятся из любого менеджера, который работает с файлами, а не с памятью игры. <a href="~/catalog/">Например, из этого</a>.',
      },

      { k: 'h2', t: 'Проверь сам', id: 'hashes' },
      { k: 'table', head: ['Файл', 'SHA-256'], rows: hashRows },
      {
        k: 'p',
        t: 'Хеш вставляется в поиск на <a href="https://www.virustotal.com/" rel="noopener">virustotal.com</a> как есть. 2 ноября 2026 года загрузчик отметили 30 антивирусов из 66.',
      },

      { k: 'h2', t: 'Если ты его уже ставил', id: 'remove' },
      {
        k: 'steps',
        items: [
          ['Удали его папки', 'Закрой лаунчер и удали <code>%LOCALAPPDATA%\\Ulibka</code> и <code>%APPDATA%\\Ulibka</code>.'],
          ['Проверь файлы игры', 'В Steam: Dota 2, Свойства, Установленные файлы, Проверить целостность. Так уйдут его файлы из <code>game\\bin\\win64</code>.'],
          ['Проверь параметры запуска', 'Лаунчер вписывает в параметры запуска Доты свои. Убери то, что ставил не ты.'],
          ['Верни то, что поменял спуфер', 'Если ты его включал, MAC-адрес и <code>MachineGuid</code> остались подменёнными. MAC возвращается в свойствах адаптера: Дополнительно, Сетевой адрес, Отсутствует.'],
          ['Выйди из их Telegram', 'Отпишись от бота и каналов, если они тебе не нужны.'],
        ],
      },

      { k: 'h2', t: 'Вопросы', id: 'faq' },
      {
        k: 'faq',
        items: [
          ['Забанят ли за Ulibka Launcher?', 'Мы не знаем, когда Valve начнёт банить за эту библиотеку. Знаем, что внедрение кода в игру и подделка сообщений координатора это то, за что Valve банит: в 2023 году она забанила больше 40 000 аккаунтов за чит, который читал данные клиента.'],
          ['Чем это отличается от модов?', 'Мод это файл, который игра читает сама, как свой перевод. Он не лезет в память игры, не трогает аккаунт и снимается одним кликом. <a href="~/docs/safe/">Безопасны ли моды</a>.'],
          ['Ulibka Launcher связан с Dota 2 Mod Manager?', 'Нет. Другие люди, другой код, и никаких договорённостей между нами нет.'],
          ['Зачем вы это пишете, вы же конкуренты?', 'Потому что его находят через поиск и не знают, что он делает. А раз мы конкуренты, всё выше можно проверить без нас.'],
        ],
      },
    ],
  },
};

export const rivalDocs = { en, ru };
