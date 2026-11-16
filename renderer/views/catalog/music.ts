/* Background music of the user's own: the window, opened from the Workshop. Each song added is
 * read here into what the compiler takes (catalog/music/song.ts) and kept by the core at once, so
 * the build sends only ids; the build compiles the songs and every music pack's events into one
 * mod in My mods (crates/mm-core/src/looks/own_music_service.rs). */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { toast } from '../../ui/toast.ts';
import { showMusicModal } from '../../catalog/modal/root.tsx';
import { duration, songBytes } from '../../catalog/music/song.ts';
import type { MusicModalModel, MusicSong, SongRole } from '../../catalog/music/MusicModal.tsx';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';

let open = false;
let m: MusicModalModel = blank();
let songsOn = 0;
const player = new Audio();
sharesOverlay(() => { open = false; stop(); });

function blank(): MusicModalModel {
  return { songs: [], menu: true, game: true, installed: false, dirty: false, playing: null, busy: null };
}

/** How many songs are on, for the Workshop's tile. */
export const musicOn = (): number => songsOn;

/** Read once when the Workshop draws, so the tile can say what is on. */
export async function readMusic(): Promise<void> {
  const r = await window.api.music.state().catch(() => null);
  if (r && !r.error && 'songs' in r) songsOn = r.installed ? r.songs.length : 0;
}

const draw = () => { if (open) showMusicModal(m, actions); };
function stop(): void { player.pause(); m = { ...m, playing: null }; }

/** The window, on the songs on now. */
export async function openMusic(from: Element | null): Promise<void> {
  const r = await window.api.music.state();
  if (r.error || !('songs' in r)) { toast(r.error || L`Не удалось прочитать музыку`, 'error'); return; }
  takeOverlay();
  open = true;
  songsOn = r.installed ? r.songs.length : 0;
  m = {
    ...blank(), installed: r.installed, menu: r.menu !== false, game: r.game !== false,
    songs: r.songs.map((s) => ({ id: s.id, name: s.name, seconds: s.seconds ?? 0, url: null, role: s.role ?? 'calm' })),
  };
  openOverlay(draw, from);
}

/** Songs read and kept one after another, each drawn as it is done. */
async function add(files: File[]): Promise<void> {
  if (m.busy !== null) return;
  const start = m.songs.length;
  const fresh: MusicSong[] = files.map((f) => ({ id: null, name: f.name.replace(/\.[^.]+$/, ''), seconds: 0, url: URL.createObjectURL(f), role: 'calm' as const }));
  m = { ...m, songs: [...m.songs, ...fresh], dirty: true, busy: { done: 0, of: files.length } };
  draw();
  const failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const at = start + i;
    try {
      const seconds = await duration(fresh[i].url!);
      const bytes = await songBytes(files[i], seconds);
      const r = await window.api.music.keep(bytes);
      if (r.error || !('id' in r)) throw new Error(r.error || 'keep');
      m = { ...m, songs: m.songs.map((s, j) => (j === at ? { ...s, id: r.id, seconds } : s)) };
    } catch (err) {
      failed.push(`${files[i].name}: ${String((err as Error)?.message || err)}`);
      m = { ...m, songs: m.songs.map((s, j) => (j === at ? { ...s, id: '' } : s)) };
    }
    m = { ...m, busy: { done: i + 1, of: files.length } };
    draw();
  }
  // a song that could not be read leaves the list
  m = { ...m, busy: null, songs: m.songs.filter((s) => s.id !== '') };
  if (failed.length) toast(failed.join('\n'), 'error', 10000);
  draw();
}

function play(i: number): void {
  const s = m.songs[i];
  if (!s?.url) return;
  if (m.playing === i) { stop(); draw(); return; }
  player.src = s.url;
  player.onended = () => { m = { ...m, playing: null }; draw(); };
  void player.play();
  m = { ...m, playing: i };
  draw();
}

function remove(i: number): void {
  if (m.playing === i) stop();
  const s = m.songs[i];
  if (s?.url) URL.revokeObjectURL(s.url);
  const playing = m.playing !== null && m.playing > i ? m.playing - 1 : m.playing;
  m = { ...m, songs: m.songs.filter((_, j) => j !== i), dirty: true, playing };
  draw();
}

async function install(): Promise<void> {
  if (m.busy !== null || m.songs.some((s) => !s.id)) return;
  stop();
  m = { ...m, busy: 'build' };
  draw();
  const list = m.songs.map((s) => ({ id: s.id!, name: s.name, seconds: Math.round(s.seconds), role: s.role }));
  const r = await window.api.music.install(list, m.menu, m.game).catch((err) => ({ error: String(err?.message || err) }));
  m = { ...m, busy: null };
  if (r.error) { toast(r.error, 'error', 10000); draw(); return; }
  const on = 'record' in r && !!r.record;
  toast(on ? L`Собрано и стоит в «Моих модах»` : L`Музыка как в игре`);
  songsOn = on ? list.length : 0;
  m = { ...m, installed: on, dirty: false };
  await refreshInstalledIndex();
  void import('../studio.ts').then((st) => st.refreshStudio());
  draw();
}

function close(): void {
  stop();
  for (const s of m.songs) if (s.url) URL.revokeObjectURL(s.url);
  closeOverlay();
}

const actions = {
  close,
  add: (files: File[]) => void add(files),
  remove,
  play,
  place: (where: 'menu' | 'game', on: boolean) => { m = { ...m, [where]: on, dirty: true }; draw(); },
  role: (i: number, role: SongRole) => { m = { ...m, dirty: true, songs: m.songs.map((s, j) => (j === i ? { ...s, role } : s)) }; draw(); },
  install: () => void install(),
};
