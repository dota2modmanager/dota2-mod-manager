/* The Workshop (3.0): everything the app makes out of the user's own game, on one screen.
 *
 * Each of these used to be the first card of some catalog category: the HUD scale first among the
 * HUDs, the rank first among the ranks, the sound of your own first among the hero sounds, the
 * arcanas first among the tools. Somebody who never opened that category never met the feature,
 * and the release notes were the only place that said it existed. Here they stand together,
 * grouped by what in the game they change, each with one line on what it does and what is on now.
 *
 * The windows are the same ones the catalog opens (views/catalog/*.ts). A tile the user has not
 * opened yet says "New", and the tab says so too until every new one has been opened once. */
import { registerView, switchView, pane } from '../core/router.ts';
import { state } from '../core/store.ts';
import { paint } from '../ui/transitions.ts';
import { spotlight, waitFor } from '../ui/spotlight.ts';
import { openItemHeroModal } from './item-hero.ts';
import { firstHubHero } from './item-hub.ts';
import { arcanaLeads, openArcanaWindow } from './catalog/arcana.ts';
import { mapLookLead, openMapLooks } from './catalog/map-looks.ts';
import { soundLead, openSounds } from './catalog/sounds.ts';
import { backgroundLead, openBackground } from './catalog/background.ts';
import { hudLead, openHud } from './catalog/hud.ts';
import { rankLead, openRank } from './catalog/rank.ts';
import { decorLead, openDecor } from './catalog/decor.ts';
import { openCreator } from './creator.ts';
import { ITEMS_HOME } from './catalog/sections.ts';
import { showStudio } from '../studio/root.tsx';
import type { StudioGroup, StudioTile } from '../studio/StudioScreen.tsx';
import { isNew, markSeen, paintStudioDot } from './studio-seen.ts';

registerView('studio', () => renderStudio());

/** The site's guide to making a mod with an AI assistant, in the window's language. */
const aiGuide = () => (window.I18N_LANG === 'ru' ? 'https://dota2modmanager.com/ru/docs/ai-mods/' : 'https://dota2modmanager.com/docs/ai-mods/');

async function goItems(): Promise<void> {
  state.activeCategory = ITEMS_HOME;
  await switchView('items');
}

/** Settings, scrolled to the hero grids' switches and ringed: the block draws once the account is read. */
async function goGrids(): Promise<void> {
  await switchView('settings');
  await spotlight('#gridBlock');
}

/** The first hero's window in Items, its "Recolour" button ringed: the recolour lives there, per hero. */
async function goPaint(): Promise<void> {
  await goItems();
  const hero = await waitFor(firstHubHero, 8000);
  if (!hero) return;
  openItemHeroModal(hero, null);
  await spotlight('#heroPaintBtn');
}

async function importVpk(): Promise<void> {
  await switchView('library');
  document.getElementById('importVpkBtn')?.click();
}

const on = (text: string) => ({ text, on: true });

async function groups(): Promise<StudioGroup[]> {
  const [arcanas, towers, trees] = await Promise.all([
    arcanaLeads().catch(() => []), mapLookLead('towers').catch(() => null), mapLookLead('trees').catch(() => null),
  ]);
  const sounds = soundLead('hero-sounds');
  const hud = hudLead('huds');
  const tile = (t: Omit<StudioTile, 'fresh'>): StudioTile => ({ ...t, fresh: isNew(t.id) });

  return [
    { id: 'hero', title: L`Герой`, tiles: [
      tile({ id: 'builder', icon: 'checkroom', title: L`Конструктор героев`, text: L`Любой предмет из игры на любого героя: наборы, арканы, персоны, стили и эффекты.`, open: () => goItems() }),
      tile({ id: 'paint', icon: 'format_paint', title: L`Перекраска героя`, text: L`Тело, оружие и эффекты в свои цвета, по частям. Открой героя в «Предметах» и нажми «Перекрасить».`, open: () => goPaint() }),
      tile({ id: 'sounds', icon: 'graphic_eq', title: L`Свой звук на способность`, text: L`Твой файл вместо звука игры или поверх него`,
        status: sounds?.installed ? on(L`Героев со своими звуками: ${sounds.installed}`) : undefined, open: (el) => openSounds(el) }),
    ] },
    // arcanas and the immortals whose colour is baked into their effects, one tile each
    { id: 'colors', title: L`Свой цвет предмета`, tiles: arcanas.map((a) => tile({ id: `arcana:${a.set}`, icon: 'palette', picture: a.picture, title: a.name,
      text: L`Любой из призматических гемов игры или свой цвет, на модели и на эффектах.`,
      status: a.installed ? on(L`Свой цвет стоит`) : undefined, open: (el) => openArcanaWindow(a.set, el) })) },
    { id: 'map', title: L`Карта`, tiles: [
      ...(towers ? [tile({ id: 'towers', icon: 'fort', title: L`Башни из игры`, text: L`Башни любого события, свои у Света и у Тьмы.`,
        status: towers.installed ? on(L`Стоят`) : undefined, open: (el) => openMapLooks('towers', el) })] : []),
      ...(trees ? [tile({ id: 'trees', icon: 'park', title: L`Деревья из игры`, text: L`Деревья любого сезона, свои на каждой стороне.`,
        status: trees.installed ? on(L`Стоят`) : undefined, open: (el) => openMapLooks('trees', el) })] : []),
      tile({ id: 'decor', icon: 'grass', title: L`Карта без декора`, text: L`Трава, цветы, камни и мусор убраны с карты: чище видно, легче видеокарте.`,
        status: decorLead('optimization')?.installed ? on(L`Убран`) : undefined, open: (el) => openDecor(el) }),
    ] },
    { id: 'ui', title: L`Интерфейс`, tiles: [
      tile({ id: 'background', icon: 'wallpaper', title: L`Свой фон главного меню`, text: L`Картинка, GIF или видео вместо фона меню.`,
        status: backgroundLead('backgrounds')?.installed ? on(L`Стоит`) : undefined, open: (el) => openBackground(el) }),
      tile({ id: 'hud', icon: 'aspect_ratio', title: L`Размер интерфейса в игре`, text: L`HUD меньше или больше, чем разрешают настройки игры.`,
        status: hud?.scale != null ? on(`${hud.scale}%`) : undefined, open: (el) => openHud(el) }),
      tile({ id: 'rank', icon: 'military_tech', title: L`Ранг и уровни героев`, text: L`Своя медаль и уровни героев на твоём экране. Видишь только ты.`,
        status: rankLead('ranks')?.installed ? on(L`Стоит`) : undefined, open: (el) => openRank(el) }),
      tile({ id: 'grids', icon: 'grid_view', title: L`Сетки героев`, text: L`Герои по проценту побед, по атрибутам и по частоте пиков этого патча, прямо в выборе героя.`, open: () => goGrids() }),
    ] },
    { id: 'make', title: L`Своё`, tiles: [
      tile({ id: 'creator', icon: 'edit_note', title: L`Кабинет автора`, text: L`Собери свой мод в архив по правилам каталога: стили, обложка, описание.`, open: (el) => openCreator(el) }),
      tile({ id: 'import', icon: 'upload_file', title: L`Поставить свой VPK`, text: L`Мод из файла, архива или папки: приложение само узнает героя и предметы.`, open: () => importVpk() }),
      tile({ id: 'ai', icon: 'auto_awesome', title: L`Мод с помощью ИИ`, text: L`Опиши мод словами, ИИ-ассистент соберёт его из файлов игры. Пошаговый гайд на сайте.`, external: true,
        open: () => { void window.api.misc.openExternal(aiGuide()); } }),
    ] },
  ];
}

async function renderStudio(): Promise<void> {
  const list = await groups();
  paintStudioDot();
  await paint(() => showStudio(pane('studio'), list, (t, el) => {
    markSeen(t.id);
    paintStudioDot();
    void t.open(el);
    if (t.fresh) void renderStudio(); // the "New" comes off the tile just opened
  }));
}

/** Drawn again when what a tile says changed under it (a tool installed from its window). */
export function refreshStudio(): void {
  if (state.view === 'studio') void renderStudio();
}

paintStudioDot();
