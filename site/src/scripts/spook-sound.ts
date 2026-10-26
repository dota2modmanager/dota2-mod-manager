/**
 * The site's sounds, made in the browser rather than downloaded: Web Audio oscillators and
 * filtered noise through one dark room, so nothing is fetched and nothing new has to be allowed by
 * the page's content policy.
 *
 * Horror, the way film scores do it, and nothing a mobile game would play for a win: no bells, no
 * major chords, no giggles. A low drone two notes a semitone apart that never settles, a heart
 * felt in the chest, strings bowed high and close together (the "Psycho" stab), breath drawn
 * through teeth, wet scuttling, a metal scrape now and then, sound pulled in backwards before a
 * blow to the floor.
 *
 * The chase's (scripts/chase.ts) can only start inside the click that begins it, which is what
 * browsers ask before a page may make a sound; the short ones below make their own context from
 * whatever click calls them. M mutes all of it during the chase, and the choice is kept
 * (localStorage mm-sound).
 */

export interface Spook {
  heart(strength: number): void;
  feet(speed: number): void;
  whoosh(): void;
  giggle(): void;
  tension(breath: number): void;
  caught(): void;
  toggle(): boolean;
  stop(): void;
}

const QUIET: Spook = { heart() {}, feet() {}, whoosh() {}, giggle() {}, tension() {}, caught() {}, toggle: () => false, stop() {} };

const muted = () => { try { return localStorage.getItem('mm-sound') === '0'; } catch { return false; } };

type Kit = {
  ctx: AudioContext;
  out: (node: AudioNode, reverb?: boolean) => void;
  burst: (at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q?: number, attack?: number) => void;
  tone: (at: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number, attack?: number) => OscillatorNode;
  master: GainNode;
};

/** A context, a room, and the two ways every sound here is made: a band of noise and a voice. */
function kit(level = 0.55): Kit | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try { ctx = new Ctx(); } catch { return null; }
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = level;
  const squash = ctx.createDynamicsCompressor();
  master.connect(squash).connect(ctx.destination);
  // a stone room: a few seconds of decaying noise as the impulse, darker at the tail
  const room = ctx.createConvolver();
  const len = Math.round(ctx.sampleRate * 3.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) { lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = lp * (1 - i / len) ** 2.4; }
  }
  room.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  room.connect(wet).connect(master);
  const out = (node: AudioNode, reverb = true) => { node.connect(master); if (reverb) node.connect(room); };

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const burst: Kit['burst'] = (at, dur, type, f0, f1, gain, q = 1, attack = Math.min(0.04, dur / 3)) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g);
    out(g);
    src.start(at, Math.random(), dur + 0.05);
  };
  const tone: Kit['tone'] = (at, dur, type, f0, f1, gain, attack = 0.012) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    out(g);
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  };
  return { ctx, out, burst, tone, master };
}

/** Strings bowed hard and high, a semitone apart, trembling: the stab of every slasher film. */
function stab(k: Kit, at: number, base: number, dur: number, gain: number): void {
  for (const ratio of [1, 1.0595, 1.1225, 1.5]) {
    const o = k.tone(at, dur, 'sawtooth', base * ratio, base * ratio * 0.96, gain, 0.004);
    const trem = k.ctx.createOscillator();
    const amt = k.ctx.createGain();
    trem.frequency.value = 17 + Math.random() * 8;
    amt.gain.value = base * ratio * 0.015;
    trem.connect(amt).connect(o.frequency);
    trem.start(at); trem.stop(at + dur + 0.05);
  }
  k.burst(at, dur * 0.8, 'bandpass', base * 2.4, base * 1.6, gain * 3, 5, 0.004);
}

/** Breath drawn in through teeth, or let out: noise through two vowel-like bands, shuddering. */
function breath(k: Kit, at: number, dur: number, gain: number, rising: boolean): void {
  for (const [f, q] of [[750, 4], [2300, 6]] as const) {
    const src = k.ctx.createBufferSource();
    const buf = k.ctx.createBuffer(1, Math.ceil(k.ctx.sampleRate * (dur + 0.1)), k.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = buf;
    const bp = k.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(rising ? f * 0.8 : f * 1.1, at);
    bp.frequency.linearRampToValueAtTime(rising ? f * 1.1 : f * 0.75, at + dur);
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + dur * (rising ? 0.85 : 0.15));
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    // the shudder: the breath catches a dozen times a second
    const shake = k.ctx.createOscillator();
    const amt = k.ctx.createGain();
    shake.frequency.value = 11 + Math.random() * 5;
    amt.gain.value = gain * 0.6;
    shake.connect(amt).connect(g.gain);
    src.connect(bp).connect(g);
    k.out(g);
    src.start(at); shake.start(at); shake.stop(at + dur);
  }
}

export function spook(): Spook {
  const k = kit(muted() ? 0 : 0.55);
  if (!k) return QUIET;
  const { ctx, burst, tone, out, master } = k;
  const now = () => ctx.currentTime;

  // ---- the bed: a drone of two notes a semitone apart, beating, under a low-pass that breathes ----
  const bed = ctx.createGain();
  bed.gain.setValueAtTime(0.0001, now());
  bed.gain.exponentialRampToValueAtTime(0.2, now() + 3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 9;
  const lfo = ctx.createOscillator();
  const lfoAmt = ctx.createGain();
  lfo.frequency.value = 0.09; lfoAmt.gain.value = 130;
  lfo.connect(lfoAmt).connect(lp.frequency);
  const saws = [41.2, 43.65, 61.7].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); return o; });
  lp.connect(bed);
  out(bed);
  // and high above it a glassy cluster, three sines a semitone apart, barely there
  const glass = ctx.createGain();
  glass.gain.value = 0.006;
  const glassVoices = [1661, 1760, 1865].map((f) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(glass); return o; });
  out(glass);
  for (const o of [...saws, lfo, ...glassVoices]) o.start();

  // the lights going out: sound pulled in backwards, then a blow to the floor and a stab
  burst(now(), 0.9, 'highpass', 300, 5000, 0.35, 0.7, 0.88);
  tone(now() + 0.9, 2.2, 'sine', 58, 24, 1, 0.004);
  burst(now() + 0.9, 1.4, 'lowpass', 1100, 70, 0.55, 1, 0.003);
  stab(k, now() + 0.9, 466, 1.1, 0.035);

  // now and then, somewhere in the dark, metal dragged over stone
  let scraper = 0;
  const scrape = () => {
    const t = now();
    const o = tone(t, 1.8, 'sawtooth', 70 + Math.random() * 30, 55, 0.07, 0.3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 14;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1700, t + 1.8);
    o.disconnect();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(bp).connect(g);
    out(g);
    scraper = window.setTimeout(scrape, 6000 + Math.random() * 7000);
  };
  scraper = window.setTimeout(scrape, 4000);

  let lastFeet = 0, lastBreath = 0;
  const sp: Spook = {
    heart(strength) {
      // lub-dub, low enough to be felt
      const t = now();
      tone(t, 0.2, 'sine', 52, 30, 0.7 * strength, 0.006);
      burst(t, 0.1, 'lowpass', 240, 70, 0.22 * strength);
      tone(t + 0.17, 0.16, 'sine', 46, 28, 0.45 * strength, 0.006);
    },
    feet(speed) {
      const t = now();
      // wet scuttling, legs on wood: clicks in uneven clusters, closer together the faster it runs
      if (speed < 220 || t - lastFeet < 0.09 - Math.min(0.06, speed / 22000)) return;
      lastFeet = t;
      const n = 1 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) burst(t + i * 0.018, 0.025, 'bandpass', 1500 + Math.random() * 900, 900, 0.1 * Math.min(1, speed / 900), 8, 0.002);
    },
    whoosh() {
      // a blade through air, close by
      burst(now(), 0.28, 'bandpass', 300, 3200, 0.5, 2.2, 0.06);
    },
    giggle() {
      // not a giggle any more: a breath let out through the teeth, right behind you
      const t = now();
      if (t - lastBreath < 2.2) return;
      lastBreath = t;
      breath(k, t, 0.9, 0.22, false);
    },
    tension(b) {
      // the bed sinks and darkens as the runner gives out, and the glass above it grows
      const t = now();
      lp.frequency.setTargetAtTime(130 + 240 * b, t, 0.4);
      saws.forEach((o, i) => o.detune.setTargetAtTime(-300 * (1 - b) - i * 6, t, 0.6));
      glass.gain.setTargetAtTime(0.004 + 0.02 * (1 - b), t, 0.6);
    },
    caught() {
      // no fanfare: the stab, a blow, and one long low note that does not resolve
      const t = now();
      clearTimeout(scraper);
      bed.gain.setTargetAtTime(0.0001, t, 0.08);
      glass.gain.setTargetAtTime(0.0001, t, 0.05);
      stab(k, t, 554, 1.4, 0.05);
      tone(t, 2.6, 'sine', 62, 22, 1, 0.003);
      burst(t, 1.6, 'lowpass', 1400, 60, 0.6, 1, 0.003);
      tone(t + 0.6, 6, 'sawtooth', 36.7, 36.7, 0.06, 1.5);
      tone(t + 0.6, 6, 'sawtooth', 38.9, 38.5, 0.06, 1.5);
    },
    toggle() {
      const off = master.gain.value > 0;
      master.gain.setTargetAtTime(off ? 0 : 0.55, now(), 0.05);
      try { localStorage.setItem('mm-sound', off ? '0' : '1'); } catch { /* private mode */ }
      return !off;
    },
    stop() {
      clearTimeout(scraper);
      master.gain.setTargetAtTime(0, now(), 0.25);
      setTimeout(() => { void ctx.close(); }, 1600);
    },
  };
  return sp;
}

/** Whether the sound is on (it is, unless muted with M before). */
export const soundOn = () => !muted();

/** A short sound in a context of its own, closed again once it has rung out. */
function once(seconds: number, play: (k: Kit, t: number) => void, level = 0.55): void {
  if (muted()) return;
  const k = kit(level);
  if (!k) return;
  play(k, k.ctx.currentTime);
  setTimeout(() => { void k.ctx.close(); }, seconds * 1000 + 400);
}

/**
 * The scream of a wrong turn in the hunt (Hunt.astro): the stab, high and hard, over a shriek of
 * noise tearing upwards and a blow under it.
 */
export function shriek(): void {
  once(1.6, (k, t) => {
    stab(k, t, 1245, 0.9, 0.06);
    k.burst(t, 0.8, 'bandpass', 800, 4200, 0.45, 7, 0.01);
    k.tone(t, 1.2, 'sine', 70, 26, 0.9, 0.003);
  });
}

/** Somebody breathing out right beside the ear: what the eyes in the margins answer with. */
export function whisper(): void {
  once(1.2, (k, t) => breath(k, t, 1, 0.3, Math.random() < 0.5), 0.6);
}

/** A jump: silence sucked in backwards for a moment, then everything at once. */
export function stinger(): void {
  once(3, (k, t) => {
    k.burst(t, 0.35, 'highpass', 600, 6000, 0.3, 0.7, 0.33);
    stab(k, t + 0.35, 932, 1.2, 0.06);
    k.tone(t + 0.35, 2.2, 'sine', 58, 22, 1, 0.003);
    k.burst(t + 0.35, 1.2, 'lowpass', 1500, 70, 0.6, 1, 0.003);
  });
}

/**
 * An old telephone ringing in an empty house: two bells struck fast by a hammer, a burst, a pause.
 * Rings until the returned function is called.
 */
export function ring(): () => void {
  if (muted()) return () => {};
  const k = kit(0.4);
  if (!k) return () => {};
  let stopped = false;
  const peal = () => {
    if (stopped) return;
    const t = k.ctx.currentTime;
    for (let i = 0; i < 22; i++) {
      const at = t + i * 0.05;
      k.tone(at, 0.09, 'triangle', 1180, 1170, 0.05, 0.002);
      k.tone(at, 0.09, 'sine', 1650, 1640, 0.03, 0.002);
    }
    setTimeout(peal, 3000);
  };
  peal();
  return () => { stopped = true; setTimeout(() => { void k.ctx.close(); }, 600); };
}
