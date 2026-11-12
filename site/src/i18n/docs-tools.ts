/**
 * The two guides about what the app builds rather than installs: the item builder and the Workshop.
 * Merged into the rest in docs.ts. Their pictures are in doc-shots.ts.
 */
import type { Doc } from './docs.ts';

type Slug = 'builder' | 'workshop';

const en: Record<Slug, Doc> = {
  builder: {
    slug: 'builder',
    title: 'Dota 2 item builder: any item on any hero, with a 3D preview',
    h1: 'The item builder: any item on any hero',
    description:
      'Dress a Dota 2 hero in sets, arcanas and items from the game on your own screen, see it in a live 3D preview first, and save the look.',
    lead: 'Open a hero, pick an item for each slot and watch it on the hero in 3D before anything reaches the game. Everything you can pick comes from your own game files, so nothing is downloaded and a new item appears when Valve adds it.',
    card: 'Sets, arcanas and single items on any hero, a live 3D preview, and which picks need the item table.',
    updated: '2026-11-07',
    blocks: [
      { k: 'h2', t: 'What it does', id: 'what' },
      {
        k: 'p',
        t: 'The Items tab lists every hero. Choose one and you get a changing room: one row for each slot the hero has, with every item the game holds for that slot, styles included. Only your screen shows the result. Your account gets no item and the other players see the hero as usual.',
      },

      { k: 'h2', t: 'Building a look', id: 'build' },
      {
        k: 'steps',
        items: [
          ['Open the hero', 'Go to Items and click the hero.'],
          ['Pick the items', 'Click a slot, search by name, and pick an item. A set fills every slot it covers at once.'],
          ['Check it in 3D', 'Turn on the 3D preview and look from every side before you apply anything.'],
          ['Apply', 'The app builds the look and installs it. Dota picks it up the next time it starts.'],
        ],
      },

      { k: 'h2', t: 'The 3D preview', id: 'preview' },
      {
        k: 'list',
        items: [
          'Items follow the hero\'s bones, the way they do in a match.',
          'Drag to tilt, use the right button to shift and the wheel to zoom. WASD with Q and E flies the camera, and a double click puts it back.',
          'The list above the stage plays any animation of the hero, and the motions follow what the hero wears.',
          'Wearables play their own animations, second models show, and parts an item hides disappear.',
        ],
      },

      { k: 'h2', t: 'Files, and when the item table comes in', id: 'files' },
      {
        k: 'p',
        t: 'Hero items install as ordinary files. The app leaves <code>gameinfo</code> and the signature file alone and asks for nothing. Those files carry an item\'s effects, its material set, the hero\'s motions, the parts it hides and its second model.',
      },
      {
        k: 'p',
        t: 'A few picks need more than files: item size, kill effects and a few others. The window names them before you apply. They use the item table, which asks once and can be reverted byte for byte. <a href="~/docs/safe/">What the app writes into the game</a>.',
      },
      {
        k: 'faq',
        items: [
          ['Do the other players see my items?', 'No. The look is drawn on your screen alone. Your account owns nothing new.'],
          ['What happens after a Dota patch?', 'The app checks its work after an update and rebuilds what the patch changed. <a href="~/docs/troubleshooting/">When something still looks wrong</a>.'],
          ['Can I take it all off?', 'Yes. Your looks sit in My mods with every other mod: switch one off or delete it.'],
        ],
      },
    ],
  },

  workshop: {
    slug: 'workshop',
    title: 'Dota 2 modding tools: effect editor, HUD editor, hero recolour, map',
    h1: 'The Workshop: edit the game without Source 2 tools',
    description:
      'Change any Dota 2 effect, move HUD panels, recolour a hero, swap towers and trees, set your own menu background and ability sounds, all built from your own game files.',
    lead: 'The Workshop builds mods out of your own game files. You move sliders and pick colours, the app does the decompiling and packing, and the result lands in My mods like any other mod.',
    card: 'The effect editor, the HUD editor, hero recolours, the map, the menu background, sounds and the rest.',
    updated: '2026-11-07',
    blocks: [
      { k: 'h2', t: 'What is in it', id: 'what' },
      {
        k: 'p',
        t: 'The tools are grouped by what they change in the game: the hero, item colours, effects, the map and the interface. Each tile says what is on right now.',
      },

      { k: 'h2', t: 'Effect editor', id: 'effects' },
      {
        k: 'p',
        t: 'Open any of the game\'s 82,000 effects through a hero, an ability, an item or a search by name, then change its size, count, lifetime, speed and colour. An ability opens as one effect with all its files changing together, and a checkbox adds the versions from items, such as an arcana\'s. The picture plays the changed effect after each edit. Edited effects rebuild themselves after a Dota update.',
      },

      { k: 'h2', t: 'HUD editor', id: 'hud' },
      {
        k: 'p',
        t: 'A plan of your screen with eleven of the game\'s panels on it. Drag a panel, nudge it by a pixel with the arrow keys, resize it, tint it, fade it or hide it. A moved minimap or bottom bar keeps its place when you mirror the HUD in the game\'s settings.',
      },

      { k: 'h2', t: 'Hero', id: 'hero' },
      {
        k: 'list',
        items: [
          '<b><a href="~/docs/builder/">Item builder.</a></b> Any item from the game on any hero, with a 3D preview.',
          '<b>Hero recolour.</b> The body, the weapon and the effects in your own colours, part by part.',
          '<b>Item colours.</b> Arcanas in any of the game\'s prismatic gems or a colour of your own, on the model and on its effects.',
          '<b>Your own ability sound.</b> Your file instead of the game\'s sound, or on top of it.',
        ],
      },

      { k: 'h2', t: 'Map', id: 'map' },
      {
        k: 'list',
        items: [
          '<b>Towers.</b> Towers from any event, different ones for Radiant and Dire.',
          '<b>Trees.</b> Trees from any season, different ones on each side.',
          '<b>Map without decor.</b> Grass, flowers, rocks and litter taken off the map, so the game reads cleaner.',
        ],
      },

      { k: 'h2', t: 'Interface', id: 'ui' },
      {
        k: 'list',
        items: [
          '<b>Menu background.</b> A picture, a GIF or a video in place of the main menu.',
          '<b>Rank and hero levels.</b> A medal and Dota Plus levels of your choice on your screen. Only you see them.',
          '<b>Hero grids.</b> Heroes by win rate, by attribute and by pick rate this patch.',
        ],
      },

      { k: 'h2', t: 'Your own mods', id: 'own' },
      {
        k: 'list',
        items: [
          '<b>Author\'s desk.</b> Package your mod to the catalog\'s rules: styles, cover and the rest.',
          '<b><a href="~/docs/own-mods/">Install your own VPK.</a></b> From a file, an archive or a folder.',
          '<b><a href="~/docs/ai-mods/">Mods with AI.</a></b> Describe the mod and an AI assistant builds it from the game\'s files.',
        ],
      },
      {
        k: 'faq',
        items: [
          ['Do I need Valve\'s Workshop Tools?', 'Not to start: the app fetches what a tool needs the first time you open it.'],
          ['Does any of this give an advantage?', 'No. The tools change how the game looks on your screen. <a href="~/docs/safe/">What the app does and does not touch</a>.'],
        ],
      },
    ],
  },
};

const ru: Record<Slug, Doc> = {
  builder: {
    slug: 'builder',
    title: 'Конструктор предметов Dota 2: любой предмет на любого героя, 3D-просмотр',
    h1: 'Конструктор предметов: любой предмет на любого героя',
    description:
      'Одень героя Доты 2 в сеты, арканы и предметы из игры на своём экране, посмотри результат в живом 3D и сохрани образ.',
    lead: 'Открой героя, выбери предмет на каждый слот и посмотри его на герое в 3D ещё до того, как что-то попадёт в игру. Всё, что можно выбрать, берётся из файлов твоей игры: ничего не скачивается, а новый предмет появляется сам, когда его добавит Valve.',
    card: 'Сеты, арканы и отдельные предметы на любого героя, живой 3D-просмотр и какому выбору нужна таблица предметов.',
    updated: '2026-11-07',
    blocks: [
      { k: 'h2', t: 'Что он делает', id: 'what' },
      {
        k: 'p',
        t: 'На вкладке «Предметы» лежат все герои. Выбери героя, и откроется примерочная: строка на каждый его слот, в ней все предметы игры для этого слота вместе со стилями. Результат виден только на твоём экране. На аккаунт ничего не добавляется, другие игроки видят героя как обычно.',
      },

      { k: 'h2', t: 'Как собрать образ', id: 'build' },
      {
        k: 'steps',
        items: [
          ['Открой героя', 'Зайди в «Предметы» и нажми на героя.'],
          ['Выбери предметы', 'Нажми на слот, найди предмет по названию и выбери его. Сет заполняет сразу все свои слоты.'],
          ['Проверь в 3D', 'Включи 3D-просмотр и посмотри со всех сторон, прежде чем применять.'],
          ['Примени', 'Приложение соберёт образ и поставит его. Дота подхватит его при следующем запуске.'],
        ],
      },

      { k: 'h2', t: '3D-просмотр', id: 'preview' },
      {
        k: 'list',
        items: [
          'Предметы следуют за костями героя, как в матче.',
          'Тяни, чтобы наклонить, правой кнопкой сдвигай, колесом приближай. WASD с Q и E двигают камеру в полёте, двойной щелчок возвращает её на место.',
          'Список над сценой запускает любую анимацию героя, а движения зависят от того, что на нём надето.',
          'Предметы играют свои анимации, вторые модели видны, а части, которые предмет скрывает, исчезают.',
        ],
      },

      { k: 'h2', t: 'Файлы, и когда нужна таблица предметов', id: 'files' },
      {
        k: 'p',
        t: 'Предметы героев ставятся обычными файлами. Приложение не трогает <code>gameinfo</code> и файл подписей и ни о чём не спрашивает. В этих файлах лежат эффекты предмета, его набор материалов, движения героя, скрытые части и вторая модель.',
      },
      {
        k: 'p',
        t: 'Некоторым выборам файлов мало: размеру предмета, эффектам убийства и ещё нескольким. Окно называет их до применения. Они работают через таблицу предметов: она один раз спрашивает разрешение и откатывается байт в байт. <a href="~/docs/safe/">Что приложение пишет в игру</a>.',
      },
      {
        k: 'faq',
        items: [
          ['Другие игроки видят мои предметы?', 'Нет. Образ рисуется только на твоём экране. На аккаунте ничего нового не появляется.'],
          ['Что будет после патча Доты?', 'После обновления приложение проверяет свою работу и пересобирает то, что изменил патч. <a href="~/docs/troubleshooting/">Если что-то всё равно выглядит не так</a>.'],
          ['Можно всё убрать?', 'Да. Образы лежат в «Моих модах» вместе с остальными модами: выключи или удали.'],
        ],
      },
    ],
  },

  workshop: {
    slug: 'workshop',
    title: 'Инструменты для модов Dota 2: редактор эффектов, HUD, перекраска героя, карта',
    h1: 'Мастерская: правь игру без инструментов Source 2',
    description:
      'Меняй любой эффект Доты 2, двигай панели HUD, перекрашивай героя, ставь другие башни и деревья, свой фон меню и звуки способностей. Всё собирается из файлов твоей игры.',
    lead: 'Мастерская собирает моды из файлов твоей игры. Ты двигаешь ползунки и выбираешь цвета, приложение само декомпилирует и упаковывает, а результат попадает в «Мои моды», как любой другой мод.',
    card: 'Редактор эффектов, редактор HUD, перекраска героя, карта, фон меню, звуки и остальное.',
    updated: '2026-11-07',
    blocks: [
      { k: 'h2', t: 'Что внутри', id: 'what' },
      {
        k: 'p',
        t: 'Инструменты разложены по тому, что они меняют в игре: герой, цвета предметов, эффекты, карта и интерфейс. На каждой плитке написано, что сейчас включено.',
      },

      { k: 'h2', t: 'Редактор эффектов', id: 'effects' },
      {
        k: 'p',
        t: 'Открой любой из 82 000 эффектов игры через героя, способность, предмет или поиск по названию и поменяй размер, количество, время жизни, скорость и цвет. Способность открывается как один эффект, все её файлы меняются вместе, а галочка добавляет версии из предметов, например из арканы. Картинка проигрывает изменённый эффект после каждой правки. После обновления Доты правленые эффекты пересобираются сами.',
      },

      { k: 'h2', t: 'Редактор HUD', id: 'hud' },
      {
        k: 'p',
        t: 'План твоего экрана с одиннадцатью панелями игры. Панель можно перетащить, сдвинуть стрелками на пиксель, изменить размер, подкрасить, сделать прозрачнее или скрыть. Сдвинутая миникарта или нижняя панель остаются на месте, если отзеркалить HUD в настройках игры.',
      },

      { k: 'h2', t: 'Герой', id: 'hero' },
      {
        k: 'list',
        items: [
          '<b><a href="~/docs/builder/">Конструктор предметов.</a></b> Любой предмет из игры на любого героя, с 3D-просмотром.',
          '<b>Перекраска героя.</b> Тело, оружие и эффекты в свои цвета, по частям.',
          '<b>Цвета предметов.</b> Арканы в любом призматическом геме игры или в своём цвете, на модели и на эффектах.',
          '<b>Свой звук на способность.</b> Твой файл вместо звука игры или поверх него.',
        ],
      },

      { k: 'h2', t: 'Карта', id: 'map' },
      {
        k: 'list',
        items: [
          '<b>Башни.</b> Башни любого события, свои у Света и у Тьмы.',
          '<b>Деревья.</b> Деревья любого сезона, свои на каждой стороне.',
          '<b>Карта без декора.</b> Трава, цветы, камни и мусор убраны с карты: чище видно.',
        ],
      },

      { k: 'h2', t: 'Интерфейс', id: 'ui' },
      {
        k: 'list',
        items: [
          '<b>Фон главного меню.</b> Картинка, GIF или видео вместо стандартного фона.',
          '<b>Ранг и уровни героев.</b> Своя медаль и уровни Dota Plus на твоём экране. Видишь только ты.',
          '<b>Сетки героев.</b> Герои по проценту побед, по атрибутам и по частоте пиков этого патча.',
        ],
      },

      { k: 'h2', t: 'Свои моды', id: 'own' },
      {
        k: 'list',
        items: [
          '<b>Кабинет автора.</b> Собери свой мод по правилам каталога: стили, обложка и остальное.',
          '<b><a href="~/docs/own-mods/">Поставить свой VPK.</a></b> Из файла, архива или папки.',
          '<b><a href="~/docs/ai-mods/">Моды с помощью ИИ.</a></b> Опиши мод словами, и ИИ-ассистент соберёт его из файлов игры.',
        ],
      },
      {
        k: 'faq',
        items: [
          ['Нужны инструменты Valve?', 'Для начала нет: приложение скачает всё нужное, когда ты в первый раз откроешь инструмент.'],
          ['Это даёт преимущество в игре?', 'Нет. Инструменты меняют только картинку на твоём экране. <a href="~/docs/safe/">Что приложение трогает, а что нет</a>.'],
        ],
      },
    ],
  },
};

export const toolDocs = { en, ru };
