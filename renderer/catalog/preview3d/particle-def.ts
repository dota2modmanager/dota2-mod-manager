/* A game particle system turned into what the 3D preview plays (issue #417): which of the game's
 * many operators it understands, and the numbers out of each. Pure: particles.ts runs the result.
 *
 * The game has hundreds of particle operators; this reads the few dozen that make most of a
 * hero's look - continuous and one-shot emitters, a lifetime, a size, a colour, a spawn around a
 * point, on a ring or on the model, a starting speed, gravity and drag, fades, a size ramp, a
 * colour ramp, a lock to its point - and draws every particle as a soft round sprite. Textures,
 * trails, ropes, meshes and lights are left out, and so is any operator not named here: the
 * effect keeps its colour, its motion and where it sits, not its exact shape.
 *
 * Everything is in Source units and Source axes, as the file has it; particles.ts converts. */
import type { ParticleDef, ParticleJson } from '../../api/preview3d.ts';

type O = { [k: string]: ParticleJson };
export type Range = [number, number];
export type V3 = [number, number, number];
export type VRange = [V3, V3];

/** A control point: the entity it is on ("self" the item, "parent" the hero) and the attachment, or the entity's origin. */
export interface ControlPoint { entity: 'self' | 'parent'; attachment: string | null; world?: V3; from?: number }

export interface ParticleSpec {
  path: string;
  max: number;
  /** particles a second while it runs, and for how long (0: for ever), after `start` */
  rate: number; duration: number; start: number;
  /** particles at once, at `start` */
  burst: number;
  life: Range; radius: Range; alpha: Range; colors: [V3, V3];
  spawn: {
    cp: number; sphere: Range; bias: V3; speed: Range; local: VRange | null; offset: VRange | null; localOffset: boolean;
    noise: VRange | null; ring: { radius: number; speed: Range } | null; onModel: boolean;
  };
  gravity: V3; drag: number; jitter: number;
  fadeIn: number; fadeOut: number; size: { from: number; to: number; start: number; end: number };
  fade: { color: V3; start: number; end: number } | null;
  lock: number | null;
  /** whether an operator kills a particle at the end of its life; one that none kills stays, as an item's glow does */
  mortal: boolean;
  /** how it is drawn; none: it only carries its children */
  draw: 'add' | 'blend' | 'none'; bright: number;
  /** the texture its sprites are, as the game names it; null for a plain glow */
  texture: string | null;
  cps: Map<number, ControlPoint>;
  children: ParticleSpec[];
}

const obj = (j: ParticleJson | undefined): O | null => (j && typeof j === 'object' && !Array.isArray(j) ? j : null);
// an operator the file switches off (m_bDisableOperator) does nothing in the game: Crystal Maiden's arcana has a disabled glow
const list = (j: ParticleJson | undefined): O[] => (Array.isArray(j) ? j.map(obj).filter((x): x is O => !!x && x.m_bDisableOperator !== true) : []);
const str = (j: ParticleJson | undefined) => (typeof j === 'string' ? j : '');

/** A number the file gives as a plain number or as a literal or uniform-random value; a range. */
export function range(j: ParticleJson | undefined, d: number): Range {
  if (typeof j === 'number') return [j, j];
  const o = obj(j);
  if (!o) return [d, d];
  if (typeof o.m_flLiteralValue === 'number') return [o.m_flLiteralValue, o.m_flLiteralValue];
  if (typeof o.m_flRandomMin === 'number' && typeof o.m_flRandomMax === 'number') return [o.m_flRandomMin, o.m_flRandomMax];
  return [d, d];
}

const one = (j: ParticleJson | undefined, d: number) => { const r = range(j, d); return (r[0] + r[1]) / 2; };

/** A vector the file gives as an array or as a literal. */
export function vec(j: ParticleJson | undefined, d: V3 = [0, 0, 0]): V3 {
  const a = Array.isArray(j) ? j : obj(j)?.m_vLiteralValue;
  return Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => typeof x === 'number') ? [a[0], a[1], a[2]] as V3 : d;
}

const alphaOf = (j: ParticleJson | undefined) => (Array.isArray(j) && typeof j[3] === 'number' ? j[3] / 255 : 1);
const rgb = (j: ParticleJson | undefined, d: V3): V3 => { const v = vec(j, [d[0] * 255, d[1] * 255, d[2] * 255]); return [v[0] / 255, v[1] / 255, v[2] / 255]; };

/** The control points the system's first configuration drives. */
function controlPoints(tree: O): Map<number, ControlPoint> {
  const out = new Map<number, ControlPoint>();
  const config = list(tree.m_controlPointConfigurations)[0];
  list(config?.m_drivers).forEach((d, i) => {
    const cp = typeof d.m_iControlPoint === 'number' ? d.m_iControlPoint : i;
    const type = str(d.m_iAttachType) || 'PATTACH_POINT_FOLLOW';
    const point = /POINT/.test(type) && str(d.m_attachmentName);
    out.set(cp, { entity: str(d.m_entityName) === 'self' ? 'self' : 'parent', attachment: point || null });
  });
  for (const op of list(tree.m_PreEmissionOperators)) {
    if (str(op._class) !== 'C_OP_SetSingleControlPointPosition') continue;
    const cp = typeof op.m_nCP1 === 'number' ? op.m_nCP1 : 1;
    out.set(cp, { entity: 'parent', attachment: null, world: vec(op.m_vecCP1Pos), ...(op.m_bUseWorldLocation === true ? {} : { from: typeof op.m_nHeadLocation === 'number' ? op.m_nHeadLocation : 0 }) });
  }
  return out;
}

/** The spec of a system and its children; the children share the parent's control points unless they drive their own. */
export function particleSpec(def: ParticleDef, inherited: Map<number, ControlPoint> = new Map()): ParticleSpec {
  const t = def.tree;
  const cps = new Map([...inherited, ...controlPoints(t)]);
  const s: ParticleSpec = {
    path: def.path,
    max: Math.min(typeof t.m_nMaxParticles === 'number' && t.m_nMaxParticles > 0 ? t.m_nMaxParticles : 1000, 400),
    rate: 0, duration: 0, start: 0, burst: 0,
    life: [one(t.m_flConstantLifespan, 1), one(t.m_flConstantLifespan, 1)],
    radius: [one(t.m_flConstantRadius, 5), one(t.m_flConstantRadius, 5)],
    alpha: [alphaOf(t.m_ConstantColor), alphaOf(t.m_ConstantColor)], colors: [rgb(t.m_ConstantColor, [1, 1, 1]), rgb(t.m_ConstantColor, [1, 1, 1])],
    spawn: { cp: 0, sphere: [0, 0], bias: [1, 1, 1], speed: [0, 0], local: null, offset: null, localOffset: false, noise: null, ring: null, onModel: false },
    mortal: false, gravity: [0, 0, 0], drag: 0, jitter: 0, fadeIn: 0, fadeOut: 0, size: { from: 1, to: 1, start: 0, end: 1 }, fade: null, lock: null,
    draw: 'none', bright: 1, texture: null, cps, children: [],
  };
  for (const e of list(t.m_Emitters)) {
    const c = str(e._class);
    const start = one(e.m_flStartTime, 0);
    if (c === 'C_OP_ContinuousEmitter' || c === 'C_OP_NoiseEmitter') {
      s.rate += c === 'C_OP_NoiseEmitter' ? (one(e.m_flOutputMin, 0) + one(e.m_flOutputMax, 100)) / 2 : one(e.m_flEmitRate, 100);
      s.duration = one(e.m_flEmissionDuration, 0);
      s.start = start;
    } else if (c === 'C_OP_InstantaneousEmitter') {
      s.burst += Math.round(one(e.m_nParticlesToEmit, 1));
      s.start = start;
    }
  }
  for (const i of list(t.m_Initializers)) initializer(s, i);
  for (const o of list(t.m_Operators)) operator(s, o);
  for (const r of list(t.m_Renderers)) {
    // a modulating renderer darkens what is behind it; drawn as a plain sprite it would be a grey square.
    // One lying on the ground is a thin line from the loadout camera; stood up to face it, a wall of light
    if (!/^C_OP_Render(Sprites|Trails|Ropes|SpriteTrail)$/.test(str(r._class)) || s.draw !== 'none' || /BLEND_MODE_MOD/.test(str(r.m_nOutputBlendMode))
      || /WORLD_Z_ALIGNED|ALIGN_TO_PARTICLE_NORMAL/.test(str(r.m_nOrientationType))) continue;
    s.draw = /ADD/.test(str(r.m_nOutputBlendMode)) || r.m_bAdditive === true ? 'add' : 'blend';
    s.bright = Math.min(4, Math.max(1, one(r.m_flOverbrightFactor, 1)));
    const input = Array.isArray(r.m_vecTexturesInput) ? obj(r.m_vecTexturesInput[0])?.m_hTexture : r.m_hTexture;
    s.texture = typeof input === 'string' ? input.toLowerCase() : null;
  }
  s.children = def.children.map((c) => particleSpec(c, cps));
  return s;
}

function initializer(s: ParticleSpec, i: O): void {
  const sp = s.spawn;
  const cp = () => { if (typeof i.m_nControlPointNumber === 'number') sp.cp = i.m_nControlPointNumber; };
  switch (str(i._class)) {
    case 'C_INIT_RandomLifeTime': s.life = [one(i.m_fLifetimeMin, 1), one(i.m_fLifetimeMax, 1)]; break;
    case 'C_INIT_RandomRadius': s.radius = [one(i.m_flRadiusMin, 5), one(i.m_flRadiusMax, 5)]; break;
    case 'C_INIT_RandomAlpha': s.alpha = [one(i.m_nAlphaMin, 255) / 255, one(i.m_nAlphaMax, 255) / 255]; break;
    case 'C_INIT_RandomColor': s.colors = [rgb(i.m_ColorMin, [1, 1, 1]), rgb(i.m_ColorMax, [1, 1, 1])]; break;
    case 'C_INIT_InitFloat': {
      const r = range(i.m_InputValue, NaN);
      if (Number.isNaN(r[0])) break;
      const field = typeof i.m_nOutputField === 'number' ? i.m_nOutputField : 3;
      if (field === 1) s.life = r;
      else if (field === 3) s.radius = r;
      else if (field === 7) s.alpha = r;
      break;
    }
    case 'C_INIT_CreateWithinSphere': case 'C_INIT_CreateWithinSphereTransform':
      cp();
      sp.sphere = [one(i.m_fRadiusMin, 0), one(i.m_fRadiusMax, 0)];
      sp.bias = vec(i.m_vecDistanceBias, [1, 1, 1]);
      sp.speed = [one(i.m_fSpeedMin, 0), one(i.m_fSpeedMax, 0)];
      if (i.m_LocalCoordinateSystemSpeedMin || i.m_LocalCoordinateSystemSpeedMax) sp.local = [vec(i.m_LocalCoordinateSystemSpeedMin), vec(i.m_LocalCoordinateSystemSpeedMax)];
      break;
    case 'C_INIT_CreateOnModel': case 'C_INIT_CreateOnModelAtHeight': case 'C_INIT_CreateOnGrid': cp(); sp.onModel = true; break;
    case 'C_INIT_RingWave': cp(); sp.ring = { radius: one(i.m_flInitialRadius, 0), speed: [one(i.m_flInitialSpeedMin, 0), one(i.m_flInitialSpeedMax, 0)] }; break;
    case 'C_INIT_PositionOffset': sp.offset = [vec(i.m_OffsetMin), vec(i.m_OffsetMax)]; sp.localOffset = i.m_bLocalCoords === true; break;
    case 'C_INIT_InitialVelocityNoise': sp.noise = [vec(i.m_vecOutputMin), vec(i.m_vecOutputMax, [1, 1, 1])]; break;
    case 'C_INIT_VelocityRandom':
      sp.speed = [one(i.m_fSpeedMin, 0), one(i.m_fSpeedMax, 0)];
      sp.local = [vec(i.m_LocalCoordinateSystemSpeedMin), vec(i.m_LocalCoordinateSystemSpeedMax)];
      break;
    default:
  }
}

/** The operators that end a particle's life: a decay, a kill at the end of a fade, a cull; one that runs only as the effect is stopped does not count. */
const KILLS = /^C_OP_(Decay\w*|FadeAndKill\w*|LifespanDecay|EndCapTimedDecay|\w*Cull)$/;

function operator(s: ParticleSpec, o: O): void {
  if (KILLS.test(str(o._class)) && str(o.m_nOpEndCapState) !== 'PARTICLE_ENDCAP_ENDCAP_ON') s.mortal = true;
  switch (str(o._class)) {
    case 'C_OP_BasicMovement': s.gravity = vec(o.m_Gravity); s.drag = one(o.m_fDrag, 0); break;
    case 'C_OP_FadeInSimple': s.fadeIn = one(o.m_flFadeInTime, 0.25); break;
    case 'C_OP_FadeOutSimple': s.fadeOut = one(o.m_flFadeOutTime, 0.25); break;
    case 'C_OP_FadeAndKill': s.fadeIn = one(o.m_flEndFadeInTime, 0.25); s.fadeOut = 1 - one(o.m_flStartFadeOutTime, 0.75); break;
    case 'C_OP_InterpolateRadius':
      s.size = { from: one(o.m_flStartScale, 1), to: one(o.m_flEndScale, 1), start: one(o.m_flStartTime, 0), end: one(o.m_flEndTime, 1) };
      break;
    case 'C_OP_ColorInterpolate': s.fade = { color: rgb(o.m_ColorFade, [1, 1, 1]), start: one(o.m_flFadeStartTime, 0), end: one(o.m_flFadeEndTime, 1) }; break;
    case 'C_OP_PositionLock': s.lock = typeof o.m_nControlPointNumber === 'number' ? o.m_nControlPointNumber : 0; break;
    case 'C_OP_Noise': case 'C_OP_VectorNoise': s.jitter = Math.max(s.jitter, Math.abs(one(o.m_flOutputMax, 0)), ...vec(o.m_vecOutputMax).map(Math.abs)); break;
    default:
  }
}
