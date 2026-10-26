/* The pumpkin's sounds (ui/pumpkin.ts), made in the window with Web Audio rather than shipped as
 * files: noise and oscillators through one dark room. Nothing here plays by itself, only in
 * answer to a hand: a spider crunched, the candle catching, a wrong key, the key that opens it.
 *
 * Horror, not a mobile game's reward: no chimes, no major chords. Low thuds felt more than
 * heard, strings scraped a semitone apart, breath through teeth.
 */

let ctx: AudioContext | null = null;
let room: ConvolverNode | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try { ctx = new AudioContext(); } catch { return null; }
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  room = ctx.createConvolver();
  const len = Math.round(ctx.sampleRate * 2.4);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  room.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  room.connect(wet).connect(master);
  return ctx;
}

function out(node: AudioNode): void { node.connect(master!); node.connect(room!); }

function env(c: AudioContext, at: number, attack: number, dur: number, peak: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  return g;
}

function noise(c: AudioContext, at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, q = 1, attack = 0.01): void {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * (dur + 0.1)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  f.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = env(c, at, attack, dur, peak);
  src.connect(f).connect(g);
  out(g);
  src.start(at);
}

function osc(c: AudioContext, at: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.01): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  const g = env(c, at, attack, dur, peak);
  o.connect(g);
  out(g);
  o.start(at);
  o.stop(at + dur + 0.05);
  return o;
}

const play = (fn: (c: AudioContext, t: number) => void) => {
  const c = audio();
  if (!c) return;
  void c.resume();
  fn(c, c.currentTime);
};

/** A spider bitten in half: a wet crack and a thud. */
export const crunch = () => play((c, t) => {
  noise(c, t, 0.09, 'bandpass', 2600, 900, 0.5, 3, 0.002);
  noise(c, t + 0.05, 0.14, 'bandpass', 1400, 500, 0.35, 2, 0.002);
  osc(c, t, 0.25, 'sine', 90, 40, 0.5, 0.004);
});

/** The candle catching inside: a breath drawn in, and a low hum that rises a semitone too far. */
export const kindle = () => play((c, t) => {
  noise(c, t, 1.4, 'lowpass', 300, 2400, 0.25, 1, 0.9);
  osc(c, t + 0.2, 2.6, 'sawtooth', 55, 58.3, 0.08, 0.8);
  osc(c, t + 0.2, 2.6, 'sawtooth', 82.4, 87.3, 0.05, 0.8);
});

/** A wrong key: strings scraped high, a semitone apart, and the pumpkin's breath through its teeth. */
export const hiss = () => play((c, t) => {
  for (const f of [1244, 1318, 1397]) {
    const o = osc(c, t, 0.7, 'sawtooth', f, f * 0.94, 0.05, 0.005);
    const trem = c.createOscillator();
    const amt = c.createGain();
    trem.frequency.value = 23; amt.gain.value = f * 0.02;
    trem.connect(amt).connect(o.frequency);
    trem.start(t); trem.stop(t + 0.75);
  }
  noise(c, t, 0.9, 'bandpass', 3000, 1600, 0.3, 6, 0.02);
});

/**
 * The key that opens it: silence pulled in backwards, then a stab of strings a tritone wide over
 * a blow to the floor, and a drone that does not resolve.
 */
export const opens = () => play((c, t) => {
  noise(c, t, 0.7, 'highpass', 400, 4000, 0.3, 0.7, 0.68);
  const at = t + 0.7;
  osc(c, at, 2.4, 'sine', 60, 26, 0.9, 0.004);
  noise(c, at, 1.1, 'lowpass', 1200, 90, 0.45, 1, 0.003);
  for (const f of [880, 932, 1245, 1319]) osc(c, at, 1.6, 'sawtooth', f, f * 0.97, 0.04, 0.004);
  osc(c, at + 0.4, 5, 'sawtooth', 55, 55, 0.05, 1.2);
  osc(c, at + 0.4, 5, 'sawtooth', 58.27, 57.5, 0.05, 1.2);
});
