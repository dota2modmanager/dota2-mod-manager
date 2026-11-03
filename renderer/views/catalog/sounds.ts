/* A sound of the user's own on a hero's event (issue #423): the card first among the hero sounds
 * and its window. The heroes and their events come from the main process
 * (src/ability-sounds-service.ts); the file is decoded here (catalog/sounds/wav.ts) and handed over
 * as 16-bit PCM; what it builds is a mod in My mods like any other, one per hero. */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showSoundModal } from '../../catalog/modal/root.tsx';
import { fileToWav } from '../../catalog/sounds/wav.ts';
import type { SoundCardModel } from '../../catalog/sounds/SoundCard.tsx';
import type { SoundModalModel } from '../../catalog/sounds/SoundModal.tsx';
import type { HeroEvent, SoundEdit } from '../../api/content.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

let open = false;
let heroes: { id: string; name: string }[] = [];
let m: Omit<SoundModalModel, 'heroes'> = blank(null);
let wav: Uint8Array | null = null;
sharesOverlay(() => { open = false; });

function blank(hero: string | null): Omit<SoundModalModel, 'heroes'> {
  return { hero, events: [], edits: [], filter: '', event: null, file: null, mode: 'replace', volume: 1, busy: false };
}

const sounded = () => [...store.installedIndex.values()].filter((r) => (r.generated as { sounds?: string } | undefined)?.sounds).length;

/** The card first among the hero sounds. */
export function soundLead(category: string): SoundCardModel | null {
  return category === 'hero-sounds' ? { installed: sounded() } : null;
}

/** The window, on `hero` when one is given (from My mods). */
export async function openSounds(from: Element | null, hero: string | null = null): Promise<void> {
  if (!heroes.length) {
    const r = await window.api.sounds.heroes();
    if (r.error || !('heroes' in r)) { toast(r.error || L`Не удалось прочитать звуки игры`, 'error'); return; }
    heroes = [...r.heroes].sort((a, b) => a.name.localeCompare(b.name));
  }
  takeOverlay();
  open = true;
  m = blank(null);
  openOverlay(draw, from);
  if (hero) await pickHero(hero);
}

function draw(): void {
  if (!open) return;
  showSoundModal({ ...m, heroes }, {
    close: closeOverlay,
    hero: (id) => void pickHero(id),
    filter: (text) => { m = { ...m, filter: text }; draw(); },
    event: (name) => { m = { ...m, event: name }; draw(); },
    file: (f) => void pickFile(f),
    mode: (mode) => { m = { ...m, mode }; draw(); },
    volume: (volume) => { m = { ...m, volume }; draw(); },
    install: () => void install(),
    remove: (event) => void remove(event),
  });
}

async function pickHero(hero: string): Promise<void> {
  const r = await window.api.sounds.hero(hero);
  if (r.error || !('events' in r)) { toast(r.error || L`Не удалось прочитать звуки игры`, 'error'); return; }
  m = { ...blank(hero), file: m.file, events: r.events as HeroEvent[], edits: r.edits as SoundEdit[] };
  draw();
}

async function pickFile(f: File): Promise<void> {
  try {
    const { wav: made, seconds } = await fileToWav(f);
    wav = made;
    if (m.file) URL.revokeObjectURL(m.file.url);
    m = { ...m, file: { name: f.name, seconds, url: URL.createObjectURL(new Blob([made.slice()], { type: 'audio/wav' })) } };
  } catch {
    toast(L`Этот файл не читается как звук`, 'error');
  }
  draw();
}

async function install(): Promise<void> {
  const { hero, event, file, mode, volume } = m;
  if (!hero || !event || !wav || !file || m.busy) return;
  m = { ...m, busy: true };
  draw();
  const r = await window.api.sounds.add(hero, event, mode, volume, wav, file.name).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: false };
  if (r.error) { toast(r.error, 'error', 8000); draw(); return; }
  toast(L`Собрано и стоит в «Моих модах»`);
  await after();
}

async function remove(event: string): Promise<void> {
  const { hero } = m;
  if (!hero || m.busy) return;
  m = { ...m, busy: true };
  draw();
  const r = await window.api.sounds.remove(hero, event).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: false };
  if (r.error) { toast(r.error, 'error'); draw(); return; }
  toast(L`Убрано`);
  await after();
}

async function after(): Promise<void> {
  await refreshInstalledIndex();
  await screen.redraw();
  if (m.hero) await pickHero(m.hero);
}

/** From My mods: the hero sounds, with the window open on that hero. */
export async function soundsFromLibrary(hero: string): Promise<void> {
  store.activeCategory = 'hero-sounds';
  await switchView('catalog');
  await screen.redraw();
  await openSounds(null, hero);
}
