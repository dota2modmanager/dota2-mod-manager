/* The built-in preview player. Catalog previews are video and audio as often as images,
 * and sending people to a browser to hear an announcer is a worse answer than 90 lines. */
import { esc } from './format.ts';
import { isAudio } from './media.ts';

function fmtTime(s: number): string {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function openPlayer(url: string, title?: string): void {
  const audio = isAudio(url);
  const overlay = document.createElement('div');
  overlay.className = 'player-overlay';
  overlay.innerHTML = `
    <div class="player-box ${audio ? 'audio' : ''}">
      ${audio
        ? `<div class="player-audio-visual"><span class="ms">graphic_eq</span></div><audio src="${esc(url)}" autoplay></audio>`
        : `<video src="${esc(url)}" autoplay playsinline></video>`}
      <div class="player-title">${esc(title || '')}</div>
      <button class="player-close" aria-label="${L`Закрыть`}"><span class="ms">close</span></button>
      <div class="player-controls">
        <button class="pl-btn" data-act="play" aria-label="${L`Пауза`}"><span class="ms">pause</span></button>
        <div class="pl-progress"><div class="pl-fill"></div><div class="pl-knob"></div></div>
        <span class="pl-time">0:00 / 0:00</span>
        <button class="pl-btn" data-act="mute" aria-label="${L`Громкость`}"><span class="ms">volume_up</span></button>
        ${audio ? '' : `<button class="pl-btn" data-act="fs" aria-label="${L`На весь экран`}"><span class="ms">fullscreen</span></button>`}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // the markup above is ours, so every part of it is there
  const part = <T extends Element = HTMLElement>(sel: string) => overlay.querySelector(sel) as T;
  const media = part<HTMLMediaElement>('video, audio');
  const box = part('.player-box');
  const playBtn = part('[data-act="play"] .ms');
  const muteBtn = part('[data-act="mute"] .ms');
  const fill = part('.pl-fill');
  const knob = part('.pl-knob');
  const timeEl = part('.pl-time');
  const progress = part('.pl-progress');

  media.loop = true;

  const close = () => {
    media.pause();
    media.removeAttribute('src'); // release the detached element so audio can't keep playing
    media.load();
    overlay.remove();
    document.removeEventListener('keydown', onKey, true); // capture flag must match addEventListener
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  part('.player-close').addEventListener('click', close);

  /* What the user asked for, not what the element reports. Until the clip arrives the element
     says it is paused while it waits to autoplay, so a pause pressed in that second read as
     "play": the clip started anyway, and only a second press stopped it. A pause before the
     start also cancels the autoplay, and fires no event, so the button is painted here. */
  let playing = true;
  const paintPlay = () => { playBtn.textContent = playing ? 'pause' : 'play_arrow'; };
  const togglePlay = () => {
    playing = !playing;
    paintPlay();
    // a play() cut short by the next pause rejects, which is the user's doing and not a fault
    if (playing) media.play().catch(() => {});
    else media.pause();
  };
  part('[data-act="play"]').addEventListener('click', togglePlay);
  media.addEventListener('play', () => { playing = true; paintPlay(); });
  media.addEventListener('pause', () => { playing = false; paintPlay(); });
  if (!audio) media.addEventListener('click', togglePlay);

  media.addEventListener('timeupdate', () => {
    const pct = media.duration ? (media.currentTime / media.duration) * 100 : 0;
    fill.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;
    timeEl.textContent = `${fmtTime(media.currentTime)} / ${fmtTime(media.duration)}`;
  });

  const seek = (e: MouseEvent) => {
    const rect = progress.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (media.duration) media.currentTime = pct * media.duration;
  };
  progress.addEventListener('mousedown', (e) => {
    seek(e);
    const move = (ev: MouseEvent) => seek(ev);
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  part('[data-act="mute"]').addEventListener('click', () => {
    media.muted = !media.muted;
    muteBtn.textContent = media.muted ? 'volume_off' : 'volume_up';
  });
  const fsBtn = overlay.querySelector('[data-act="fs"]');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else box.requestFullscreen();
    });
  }
}
