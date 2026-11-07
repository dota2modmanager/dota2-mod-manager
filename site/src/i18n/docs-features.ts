/**
 * Everything in the app, screen by screen: where each function lives and how to use it. The
 * landing’s tiles link to the sections here, so an id that changes breaks a link (site/test).
 * Read off the windows themselves (renderer/), and merged into the rest in docs.ts.
 */
import type { Doc } from './docs.ts';

export const featureDocs: Record<'en' | 'ru', { features: Doc }> = {
  en: {
    features: {
      slug: 'features',
      title: 'Dota 2 Mod Manager features: every function and how to use it',
      h1: 'Every function, and where to find it',
      description:
        'A guide to all of Dota 2 Mod Manager: the catalog, My mods, presets, the item builder and every Workshop tool, with where each one lives and how to use it.',
      lead: 'The app has five screens: Catalog, Items, Workshop, My mods and Presets, with Settings behind them. This page walks through them in that order and says where each function lives and what to press.',
      card: 'All of the app on one page: what each function does, where it lives and how to use it.',
      updated: '2026-11-07',
      blocks: [
        { k: 'h2', t: 'Before the first tool', id: 'first' },
        {
          k: 'p',
          t: 'Installing mods from the catalog needs nothing but the app. The tools that build mods from your game files need one or two helpers, and the tool\'s window offers them the first time you open it:',
        },
        {
          k: 'list',
          items: [
            '<b>ValveResourceFormat.</b> Reads the game\'s compressed files. One click in the window, about 50 MB, and it keeps itself up to date.',
            '<b>Dota 2 Workshop Tools.</b> Valve\'s free DLC in Steam, with the compiler that sounds, the HUD and the rank tool need. Its state is in Settings, under the resource compiler.',
          ],
        },

        { k: 'h2', t: 'Catalog', id: 'catalog' },
        {
          k: 'p',
          t: 'The catalog holds {mods} mods sorted the way their authors sorted them. The rail on the left lists the sections: heroes, item effects, terrains, sounds, cursors and the rest.',
        },
        {
          k: 'steps',
          items: [
            ['Find a mod', 'Type a name, a hero or an author into the search box, or open a section and filter it with the tags at the top.'],
            ['Look at it', 'Click the card. The mod\'s window shows its pictures or clip, its styles and who made it.'],
            ['Install it', 'Press Install. The app downloads the mod, picks a free pak slot and puts it in place. Dota picks it up on its next start.'],
          ],
        },
        {
          k: 'list',
          items: [
            '<b>Several at once.</b> Press Install on more cards while the first one downloads. They queue up.',
            '<b>Favourites.</b> The star on a card keeps the mod in the Favourites section.',
            '<b>Mods for adults.</b> Hidden until you switch them on in Settings.',
            '<b>Sets from the site.</b> Pick mods in the <a href="~/catalog/">web catalog</a> and send them to the app as one link.',
          ],
        },

        { k: 'h2', t: 'Items: the item builder', id: 'items' },
        {
          k: 'p',
          t: 'The Items tab lists every hero. Open one to get a row for each slot, with every item the game holds for that slot: sets, arcanas, personas, styles and effects. Pick a set to fill its slots at once, open a slot to choose its effect and style, and turn on the 3D preview to see the hero in what you picked. <b>My looks</b> keeps a look to come back to. The <a href="~/docs/builder/">item builder guide</a> covers it in full.',
        },

        { k: 'h2', t: 'Workshop', id: 'workshop' },
        {
          k: 'p',
          t: 'The Workshop tab holds the tools that build a mod from your own game files, grouped by what they change. Whatever a tool builds lands in My mods, where you switch it off or delete it like any other mod. Each tile shows in green what is on right now.',
        },

        { k: 'h2', t: 'Hero recolour', id: 'paint' },
        {
          k: 'p',
          t: '<b>Where:</b> open a hero in Items and press Recolour, the button beside the hero’s name. Pick a colour for all the parts, or for one layer each: body, weapon, abilities, attacks, items, icon and portrait.',
        },
        {
          k: 'note',
          t: 'A colour takes hold where the game stores it as a number. Part of the effects paint with textures, and the preview shows which parts took the colour.',
        },

        { k: 'h2', t: 'Item colours', id: 'colors' },
        {
          k: 'p',
          t: '<b>Where:</b> Workshop, Your own item colour. Pick an arcana, then one of the game\'s prismatic gems or a colour of your own. It paints the model and the effects. For Terrorblade, Techies and Razor you can install the whole item, or the colour alone if you own the arcana already.',
        },

        { k: 'h2', t: 'Your own sound on an ability', id: 'sounds' },
        {
          k: 'steps',
          items: [
            ['Open it', 'Workshop, Hero, Your own sound on an ability.'],
            ['Pick the ability', 'Choose a hero and a sound of theirs.'],
            ['Pick your file', 'MP3, WAV or OGG. Choose whether it replaces the game\'s sound or plays on top, and set the volume.'],
            ['Install', 'The compiler from Workshop Tools builds it.'],
          ],
        },

        { k: 'h2', t: 'Effect editor', id: 'effects' },
        {
          k: 'steps',
          items: [
            ['Open it', 'Workshop, Effects, Effect editor.'],
            ['Find the effect', 'Pick a hero and an ability on the left, or search by file name. The game has about 82,000 of them.'],
            ['Change it', 'Move the sliders for size, count, lifetime and speed, and set a colour. The preview plays each edit.'],
            ['Install', 'Your edits build into one mod. Already edited shows what you changed.'],
          ],
        },
        {
          k: 'note',
          t: 'The preview is close, not exact. Sprite shapes and trails show properly only in the game, and effects built from models or light do not draw there at all.',
        },

        { k: 'h2', t: 'Towers', id: 'towers' },
        {
          k: 'p',
          t: '<b>Where:</b> Workshop, Map, Towers from the game. Choose towers from any event, one kind for Radiant and another for Dire, then press Build. The models and their rubble come from the game\'s items.',
        },

        { k: 'h2', t: 'Trees', id: 'trees' },
        {
          k: 'p',
          t: '<b>Where:</b> Workshop, Map, Trees from the game. Choose a season for each side and press Build. The trees you can cut down change. The decoration trees at the map\'s edge stay as they are.',
        },

        { k: 'h2', t: 'Map without decor', id: 'decor' },
        {
          k: 'p',
          t: '<b>Where:</b> Workshop, Map, Map without decor. Take off plants, animals and birds, rocks and litter, or both groups. Trees, buildings, water and the ground stay. It reads the list from the map each time, and rebuilds itself after a Dota update.',
        },

        { k: 'h2', t: 'Menu background', id: 'background' },
        {
          k: 'p',
          t: '<b>Where:</b> Workshop, Interface, Your own menu background. Choose a picture, a GIF or a video up to 30 seconds, then set the dimming and the blur. A clip plays on a loop.',
        },

        { k: 'h2', t: 'HUD editor', id: 'hud' },
        {
          k: 'steps',
          items: [
            ['Open it', 'Workshop, Interface, HUD editor.'],
            ['Move the panels', 'Eleven panels sit on a plan of your screen. Drag one with the mouse, and use the arrow keys for a single pixel.'],
            ['Change a panel', 'Click it to set its size, tint and opacity, or hide it.'],
            ['Install', 'The compiler builds the style. With a HUD mod on, your layout goes on top of that mod.'],
          ],
        },

        { k: 'h2', t: 'Rank and hero levels', id: 'rank' },
        {
          k: 'p',
          t: '<b>Where:</b> Workshop, Interface, Rank and hero levels. Choose a medal, up to the top one with Top 5000, Top 100 or Top 10 on it, and set Dota Plus levels for each hero or for all of them at once. This changes your screen alone: other players see your real rank and levels.',
        },

        { k: 'h2', t: 'Hero grids', id: 'grids' },
        {
          k: 'p',
          t: '<b>Where:</b> Workshop, Interface, Hero grids. Puts grids in the game\'s hero picker: by win rate, by attribute and by pick rate in this patch. Settings holds which grids you want.',
        },

        { k: 'h2', t: 'Your own mods', id: 'own' },
        {
          k: 'list',
          items: [
            '<b>Install your own VPK.</b> Workshop, under your own mods. Give it a file, an archive or a folder. The app works out the hero and the items by itself.',
            '<b>Author\'s desk.</b> Build your mod into an archive by the catalog\'s rules: name, category, styles, cover and description. Drafts stay on your computer.',
            '<b>A mod with AI.</b> Describe the mod in words and an AI assistant builds it from the game files. <a href="~/docs/ai-mods/">Step by step</a>.',
          ],
        },

        { k: 'h2', t: 'My mods', id: 'my-mods' },
        {
          k: 'p',
          t: 'Everything you installed or built sits here, whichever tool it came from.',
        },
        {
          k: 'list',
          items: [
            '<b>Switch on and off.</b> The toggle on a row. The mod stays in your library, the game folder stays clean.',
            '<b>Load order.</b> Drag a row. When two mods carry the same file, the higher one wins, and the app shows who overrules whom.',
            '<b>Master switch.</b> Bottom right. Off, and the game starts with no mods at all. Handy before a tournament or to rule mods out.',
            '<b>Packs.</b> Tick several mods and press Combine into pack. The game loads about 99 separate paks at most, and a pack takes one slot.',
            '<b>Import.</b> Import VPK takes a file, Import folder takes every .vpk in a folder.',
            '<b>Link to the catalog.</b> A mod you installed by hand gets its picture and its updates once you link it.',
            '<b>Updates.</b> A banner on top says when a new version of a mod is out, and one press takes it.',
            '<b>Remove.</b> Tick and delete, or right-click a row for the rest of the actions.',
          ],
        },

        { k: 'h2', t: 'Presets', id: 'presets' },
        {
          k: 'steps',
          items: [
            ['Save', 'Name the preset and press Save current state. It remembers your mods and your looks.'],
            ['Apply', 'One press switches on exactly what is in the preset and everything else off.'],
            ['Share', 'Share gives you a link. Whoever opens it gets the same setup, with any missing mods downloaded. A .d2mm file does the same offline.'],
          ],
        },
        { k: 'p', t: 'Ready presets at the top of the screen are sets other people put together.' },

        { k: 'h2', t: 'Settings', id: 'settings' },
        {
          k: 'list',
          items: [
            '<b>Language and scale.</b> The interface language and the size of the window\'s contents.',
            '<b>Path to Dota 2.</b> Found automatically. Point to it by hand if you keep the game somewhere unusual.',
            '<b>Download cache.</b> Archives kept so you do not download them twice. Clearing it touches nothing installed.',
            '<b>Download proxy.</b> For networks that block the download addresses.',
            '<b>Game files and the item table.</b> See what the app changed in the game\'s own files, and put them back to Valve\'s with one press.',
            '<b>Beta versions.</b> Test builds for accounts on the testers\' list.',
          ],
        },

        { k: 'h2', t: 'When something breaks', id: 'repair' },
        {
          k: 'list',
          items: [
            '<b>Repair the app.</b> In Settings. It restores the game patch, finds lost mod files and clears what got stuck.',
            '<b>After a Dota update.</b> The app notices the patch and puts its work back by itself. It waits until Dota closes.',
            '<b>Export report.</b> In Settings, under Diagnostics. A zip with the game path, the mod list and the recent log, for the <a href="~/docs/troubleshooting/">support channel</a>.',
          ],
        },
      ],
    },
  },
  ru: {
    features: {
      slug: 'features',
      title: 'Возможности Dota 2 Mod Manager: все функции и как ими пользоваться',
      h1: 'Все функции, и где их найти',
      description:
        'Гайд по всему Dota 2 Mod Manager: каталог, «Мои моды», пресеты, конструктор предметов и все инструменты Мастерской: где что лежит и как этим пользоваться.',
      lead: 'В приложении пять экранов: Каталог, Предметы, Мастерская, Мои моды и Пресеты, а за ними Настройки. Здесь они идут по порядку: где лежит каждая функция и что нажимать.',
      card: 'Всё приложение на одной странице: что делает каждая функция, где она лежит и как ей пользоваться.',
      updated: '2026-11-07',
      blocks: [
        { k: 'h2', t: 'Перед первым инструментом', id: 'first' },
        {
          k: 'p',
          t: 'Для модов из каталога ничего, кроме приложения, не нужно. Инструментам, которые собирают моды из файлов твоей игры, нужны один-два помощника, и окно инструмента предложит их при первом открытии:',
        },
        {
          k: 'list',
          items: [
            '<b>ValveResourceFormat.</b> Читает сжатые файлы игры. Один клик в окне, около 50 МБ, дальше обновляется сам.',
            '<b>Dota 2 Workshop Tools.</b> Бесплатное DLC от Valve в Steam с компилятором, который нужен звукам, HUD и рангу. Его состояние видно в настройках, в блоке компилятора ресурсов.',
          ],
        },

        { k: 'h2', t: 'Каталог', id: 'catalog' },
        {
          k: 'p',
          t: 'В каталоге {mods} модов, разложенных так, как их разложили авторы. Слева список разделов: герои, эффекты предметов, ландшафты, звуки, курсоры и остальное.',
        },
        {
          k: 'steps',
          items: [
            ['Найди мод', 'Введи название, героя или автора в поиск, или открой раздел и отфильтруй его тегами сверху.'],
            ['Посмотри', 'Нажми на карточку. В окне мода его картинки или ролик, стили и автор.'],
            ['Поставь', 'Нажми «Установить». Приложение скачает мод, выберет свободный слот pak и положит его на место. Дота подхватит мод при следующем запуске.'],
          ],
        },
        {
          k: 'list',
          items: [
            '<b>Несколько сразу.</b> Нажимай «Установить» на других карточках, пока качается первая. Они встанут в очередь.',
            '<b>Избранное.</b> Звезда на карточке сохраняет мод в раздел «Избранное».',
            '<b>Моды 18+.</b> Скрыты, пока не включишь их в настройках.',
            '<b>Наборы с сайта.</b> Отбери моды в <a href="~/catalog/">каталоге на сайте</a> и отправь их в приложение одной ссылкой.',
          ],
        },

        { k: 'h2', t: 'Предметы: конструктор', id: 'items' },
        {
          k: 'p',
          t: 'Во вкладке «Предметы» все герои. Открой героя: у каждого слота своя строка со всеми предметами игры для него, это наборы, арканы, персоны, стили и эффекты. Набор заполняет свои слоты сразу, а в самом слоте выбирается эффект и стиль. Включи 3D-просмотр, и герой встанет на сцене в том, что ты выбрал. <b>Мои образы</b> хранят образ, чтобы к нему вернуться. Подробно в <a href="~/docs/builder/">гайде по конструктору</a>.',
        },

        { k: 'h2', t: 'Мастерская', id: 'workshop' },
        {
          k: 'p',
          t: 'Во вкладке «Мастерская» лежат инструменты, которые собирают мод из файлов твоей игры, сгруппированные по тому, что они меняют. Всё собранное попадает в «Мои моды», там выключается и удаляется как любой другой мод. Зелёным на плитке видно, что сейчас включено.',
        },

        { k: 'h2', t: 'Перекраска героя', id: 'paint' },
        {
          k: 'p',
          t: '<b>Где:</b> открой героя в «Предметах» и нажми «Перекрасить» рядом с именем героя. Выбери цвет сразу для всех частей или для каждого слоя отдельно: тело, оружие, способности, атака, предметы, иконка и портрет.',
        },
        {
          k: 'note',
          t: 'Цвет ложится там, где игра хранит его числом. Часть эффектов красит текстуры, и просмотр показывает, какие части цвет взяли.',
        },

        { k: 'h2', t: 'Свой цвет предмета', id: 'colors' },
        {
          k: 'p',
          t: '<b>Где:</b> Мастерская, «Свой цвет предмета». Выбери аркану, потом призматический гем игры или свой цвет. Красится и модель, и эффекты. Для Террорблейда, Течиса и Разора можно поставить предмет целиком или только цвет, если аркана уже куплена.',
        },

        { k: 'h2', t: 'Свой звук на способность', id: 'sounds' },
        {
          k: 'steps',
          items: [
            ['Открой', 'Мастерская, Герой, «Свой звук на способность».'],
            ['Выбери способность', 'Выбери героя и его звук.'],
            ['Выбери файл', 'MP3, WAV или OGG. Реши, заменит он звук игры или ляжет поверх, и задай громкость.'],
            ['Поставь', 'Соберёт компилятор из Workshop Tools.'],
          ],
        },

        { k: 'h2', t: 'Редактор эффектов', id: 'effects' },
        {
          k: 'steps',
          items: [
            ['Открой', 'Мастерская, Эффекты, «Редактор эффектов».'],
            ['Найди эффект', 'Выбери героя и способность слева или ищи по имени файла. В игре их около 82 000.'],
            ['Измени', 'Двигай ползунки размера, количества, времени жизни и скорости, задай цвет. Просмотр проигрывает каждую правку.'],
            ['Поставь', 'Правки соберутся в один мод. «Уже изменённые» покажут, что ты менял.'],
          ],
        },
        {
          k: 'note',
          t: 'Просмотр примерный. Форму спрайтов и следы точно показывает только игра, а эффекты из моделей и света он не рисует совсем.',
        },

        { k: 'h2', t: 'Башни', id: 'towers' },
        {
          k: 'p',
          t: '<b>Где:</b> Мастерская, Карта, «Башни из игры». Выбери башни любого события, одни для Света и другие для Тьмы, и нажми «Собрать». Модели и обломки берутся из предметов игры.',
        },

        { k: 'h2', t: 'Деревья', id: 'trees' },
        {
          k: 'p',
          t: '<b>Где:</b> Мастерская, Карта, «Деревья из игры». Выбери сезон для каждой стороны и нажми «Собрать». Меняются деревья, которые можно срубить. Декорации по краям карты остаются как есть.',
        },

        { k: 'h2', t: 'Карта без декора', id: 'decor' },
        {
          k: 'p',
          t: '<b>Где:</b> Мастерская, Карта, «Карта без декора». Убери растения, зверей и птиц, камни и мусор, или обе группы сразу. Деревья, постройки, вода и земля остаются. Список берётся из самой карты при каждой сборке, а после обновления Доты мод пересобирается сам.',
        },

        { k: 'h2', t: 'Фон главного меню', id: 'background' },
        {
          k: 'p',
          t: '<b>Где:</b> Мастерская, Интерфейс, «Свой фон главного меню». Выбери картинку, GIF или видео до 30 секунд, потом задай затемнение и размытие. Ролик повторяется по кругу.',
        },

        { k: 'h2', t: 'Редактор интерфейса', id: 'hud' },
        {
          k: 'steps',
          items: [
            ['Открой', 'Мастерская, Интерфейс, «Редактор интерфейса».'],
            ['Двигай панели', 'На плане экрана одиннадцать панелей. Тащи мышью, а стрелками сдвигай на пиксель.'],
            ['Настрой панель', 'Нажми на неё, чтобы задать размер, оттенок и непрозрачность или убрать совсем.'],
            ['Поставь', 'Стиль собирает компилятор. Если включён мод на HUD, твоя раскладка ляжет поверх него.'],
          ],
        },

        { k: 'h2', t: 'Ранг и уровни героев', id: 'rank' },
        {
          k: 'p',
          t: '<b>Где:</b> Мастерская, Интерфейс, «Ранг и уровни героев». Выбери медаль от Рекрута до Титана, а в конце Топ 5000, Топ 100 или Топ 10, и задай уровни Dota Plus каждому герою или всем сразу. Это меняет только твой экран: другие игроки видят настоящие ранг и уровни.',
        },

        { k: 'h2', t: 'Сетки героев', id: 'grids' },
        {
          k: 'p',
          t: '<b>Где:</b> Мастерская, Интерфейс, «Сетки героев». Кладёт сетки в выбор героя в самой игре: по проценту побед, по атрибутам и по частоте пиков этого патча. Какие сетки нужны, задаётся в настройках.',
        },

        { k: 'h2', t: 'Свои моды', id: 'own' },
        {
          k: 'list',
          items: [
            '<b>Поставить свой VPK.</b> Мастерская, Своё. Дай файл, архив или папку, приложение само узнает героя и предметы.',
            '<b>Кабинет автора.</b> Собери мод в архив по правилам каталога: название, категория, стили, обложка и описание. Черновики остаются на твоём компьютере.',
            '<b>Мод с помощью ИИ.</b> Опиши мод словами, ИИ-ассистент соберёт его из файлов игры. <a href="~/docs/ai-mods/">Пошаговый гайд</a>.',
          ],
        },

        { k: 'h2', t: 'Мои моды', id: 'my-mods' },
        {
          k: 'p',
          t: 'Здесь лежит всё, что ты поставил или собрал, каким бы инструментом это ни было сделано.',
        },
        {
          k: 'list',
          items: [
            '<b>Вкл и выкл.</b> Переключатель в строке. Мод остаётся в библиотеке, папка игры остаётся чистой.',
            '<b>Порядок загрузки.</b> Перетащи строку. Если у двух модов один файл, побеждает тот, что выше, и приложение показывает, кто кого перекрывает.',
            '<b>Главный переключатель.</b> Внизу справа. Выключил, и игра запускается вообще без модов. Удобно перед турниром или чтобы исключить моды из проверки.',
            '<b>Паки.</b> Отметь несколько модов и нажми «Объединить в пак». Игра грузит примерно 99 отдельных паков, а пак занимает один слот.',
            '<b>Импорт.</b> «Импорт VPK» берёт файл, «Импорт папки» берёт все .vpk из папки.',
            '<b>Привязка к каталогу.</b> Мод, поставленный вручную, после привязки получает картинку и обновления.',
            '<b>Обновления.</b> Баннер сверху скажет, что вышла новая версия мода, а одна кнопка её поставит.',
            '<b>Удаление.</b> Отметь и удали, а остальные действия лежат в меню по правому клику на строке.',
          ],
        },

        { k: 'h2', t: 'Пресеты', id: 'presets' },
        {
          k: 'steps',
          items: [
            ['Сохрани', 'Назови пресет и нажми «Сохранить текущее состояние». Он запомнит моды и образы.'],
            ['Примени', 'Одна кнопка включает ровно то, что в пресете, а всё остальное выключает.'],
            ['Поделись', '«Поделиться» даёт ссылку. Кто её откроет, получит такую же сборку, недостающие моды скачаются. То же самое без интернета делает файл .d2mm.'],
          ],
        },
        { k: 'p', t: 'Готовые пресеты вверху экрана собраны другими людьми.' },

        { k: 'h2', t: 'Настройки', id: 'settings' },
        {
          k: 'list',
          items: [
            '<b>Язык и масштаб.</b> Язык интерфейса и размер всего в окне.',
            '<b>Путь к Dota 2.</b> Находится сам. Если игра лежит в необычном месте, укажи вручную.',
            '<b>Кэш загрузок.</b> Архивы, чтобы не качать дважды. Очистка не трогает установленное.',
            '<b>Прокси загрузок.</b> Для сетей, где адреса загрузки закрыты.',
            '<b>Файлы игры и таблица предметов.</b> Видно, что приложение поменяло в файлах самой игры, и одной кнопкой можно вернуть всё как у Valve.',
            '<b>Бета-версии.</b> Тестовые сборки для аккаунтов из списка тестеров.',
          ],
        },

        { k: 'h2', t: 'Если что-то сломалось', id: 'repair' },
        {
          k: 'list',
          items: [
            '<b>Починить приложение.</b> В настройках. Возвращает патч игры, ищет пропавшие файлы модов и убирает застрявшее.',
            '<b>После обновления Доты.</b> Приложение само замечает патч и возвращает свою работу. Если Дота запущена, ждёт, пока она закроется.',
            '<b>Экспортировать отчёт.</b> В настройках, в блоке «Диагностика». Архив с путём к игре, списком модов и последними записями журнала для <a href="~/docs/troubleshooting/">поддержки</a>.',
          ],
        },
      ],
    },
  },
};
