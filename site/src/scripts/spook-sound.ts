/**
 * The chase's sound (scripts/chase.ts), made in the browser rather than downloaded: Web Audio
 * oscillators and filtered noise through one reverb, so nothing is fetched and nothing new has to
 * be allowed by the page's content policy.
 *
 * A low beating drone and a thin ghostly whine under the whole chase; a heart that thumps with
 * the red pulse on screen; scuttling feet while the runner moves fast; a whoosh and now and then
 * a giggle when a lunge misses; a boom when the lights go out; and bells when it is caught.
 *
 * It can only start inside the click that begins the chase, which is what browsers ask before a
 * page may make a sound. M mutes it, and the choice is kept (localStorage mm-sound).
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

export function spook(): Spook {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return QUIET;
  let ctx: AudioContext;
  try { ctx = new Ctx(); } catch { return QUIET; }
  void ctx.resume();
  const now = () => ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = muted() ? 0 : 0.55;
  const squash = ctx.createDynamicsCompressor();
  master.connect(squash).connect(ctx.destination);

  // a room for it all: a few seconds of decaying noise as the impulse
  const room = ctx.createConvolver();
  const len = Math.round(ctx.sampleRate * 2.6);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.8;
  }
  room.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  room.connect(wet).connect(master);
  const out = (node: AudioNode, reverb = true) => { node.connect(master); if (reverb) node.connect(room); };

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const burst = (at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.04, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g);
    out(g);
    src.start(at, Math.random() * 0.5, dur + 0.05);
  };
  const tone = (at: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number, reverb = true) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    out(g, reverb);
    o.start(at);
    o.stop(at + dur + 0.05);
  };

  // ---- the bed: two detuned saws through a slowly breathing low-pass, and a whine above ----
  const bed = ctx.createGain();
  bed.gain.setValueAtTime(0.0001, now());
  bed.gain.exponentialRampToValueAtTime(0.16, now() + 2.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 7;
  const lfo = ctx.createOscillator();
  const lfoAmt = ctx.createGain();
  lfo.frequency.value = 0.13; lfoAmt.gain.value = 140;
  lfo.connect(lfoAmt).connect(lp.frequency);
  const saws = [46.25, 46.9, 69.3].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); return o; });
  lp.connect(bed);
  out(bed);
  const whine = ctx.createOscillator();
  whine.type = 'sine'; whine.frequency.value = 932;
  const vib = ctx.createOscillator();
  const vibAmt = ctx.createGain();
  vib.frequency.value = 5.2; vibAmt.gain.value = 9;
  vib.connect(vibAmt).connect(whine.frequency);
  const whineGain = ctx.createGain();
  whineGain.gain.value = 0.012;
  whine.connect(whineGain);
  out(whineGain);
  for (const o of [...saws, lfo, whine, vib]) o.start();

  // the lights going out: a boom and a stab of two notes a tritone apart
  tone(now(), 1.8, 'sine', 70, 28, 0.9, true);
  burst(now(), 1.2, 'lowpass', 900, 80, 0.5);
  tone(now() + 0.05, 1.6, 'sawtooth', 220, 214, 0.12);
  tone(now() + 0.05, 1.6, 'sawtooth', 311, 305, 0.1);

  let lastFeet = 0, lastGiggle = 0;
  const sp: Spook = {
    heart(strength) {
      const t = now();
      tone(t, 0.16, 'sine', 62, 38, 0.55 * strength, false);
      burst(t, 0.09, 'lowpass', 300, 90, 0.18 * strength);
    },
    feet(speed) {
      const t = now();
      // patter, closer together the faster it runs
      if (speed < 220 || t - lastFeet < 0.11 - Math.min(0.07, speed / 20000)) return;
      lastFeet = t;
      burst(t, 0.035, 'bandpass', 3800 + Math.random() * 1500, 2600, 0.09 * Math.min(1, speed / 900), 4);
    },
    whoosh() {
      burst(now(), 0.32, 'bandpass', 380, 2600, 0.55, 1.4);
    },
    giggle() {
      const t = now();
      if (t - lastGiggle < 2.5) return;
      lastGiggle = t;
      // three falling "hee"s, wobbling, like a voice that is not quite one
      [0, 0.13, 0.27].forEach((d, i) => {
        const f = 820 - i * 90;
        tone(t + d, 0.11, 'triangle', f * 1.08, f * 0.86, 0.12);
        tone(t + d, 0.11, 'sine', f * 2.02, f * 1.7, 0.04);
      });
    },
    tension(breath) {
      // the bed sinks and darkens as the runner gives out
      const t = now();
      lp.frequency.setTargetAtTime(150 + 260 * breath, t, 0.4);
      saws.forEach((o, i) => o.detune.setTargetAtTime(-260 * (1 - breath) - i * 4, t, 0.6));
      whineGain.gain.setTargetAtTime(0.004 + 0.014 * breath, t, 0.5);
    },
    caught() {
      const t = now();
      tone(t, 1.2, 'sine', 90, 30, 0.8, true);
      bed.gain.setTargetAtTime(0.0001, t, 0.15);
      whineGain.gain.setTargetAtTime(0.0001, t, 0.1);
      // bells, up a bright chord, ringing on in the room
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        tone(t + 0.18 + i * 0.09, 2.2, 'sine', f, f, 0.16);
        tone(t + 0.18 + i * 0.09, 1.4, 'sine', f * 2.76, f * 2.76, 0.03);
      });
    },
    toggle() {
      const off = master.gain.value > 0;
      master.gain.setTargetAtTime(off ? 0 : 0.55, now(), 0.05);
      try { localStorage.setItem('mm-sound', off ? '0' : '1'); } catch { /* private mode */ }
      return !off;
    },
    stop() {
      const t = now();
      master.gain.setTargetAtTime(0, t, 0.25);
      setTimeout(() => { void ctx.close(); }, 1600);
    },
  };
  return sp;
}

/** Whether the sound is on (it is, unless muted with M before). */
export const soundOn = () => !muted();
