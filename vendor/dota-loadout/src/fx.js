// Source 2 particle systems (.vpcf) for three.js, ported from Source 2 Viewer's simulation
// (ValveResourceFormat/Particles, MIT) and extended with the model-bound functions it lacks
// (snapshots skinned to bones, creation on the model, locking to bones). Simulation runs in the
// game's own space (inches, Z up); the group that holds the meshes converts to glTF like Source 2
// Viewer's exporter does (scale 0.0254, Z-up to Y-up).
import * as THREE from 'three';
import { resolveSpriteTextures } from './sprite-textures.js';
import {blobAppearance} from './blob-appearance.js';
import { calibrateCosmicFxRenderer } from './tinker-cosmic-fx-calibration.js';
import {MarchingCubes} from 'three/addons/objects/MarchingCubes.js';

// ParticleField
const F = { Position: 0, LifeDuration: 1, PositionPrevious: 2, Radius: 3, Roll: 4, RollSpeed: 5, Color: 6, Alpha: 7, CreationTime: 8,
  SequenceNumber: 9, TrailLength: 10, ParticleId: 11, Yaw: 12, SecondSequenceNumber: 13, HitboxIndex: 14, HitboxOffsetPosition: 15,
  AlphaAlternate: 16, ScratchVector: 17, ScratchFloat: 18, NoneDisabled: 19, Pitch: 20, Normal: 21, GlowRgb: 22, GlowAlpha: 23,
  ScratchFloat1: 26, ScratchFloat2: 27, ScratchVector2: 30, ForceScale: 34, ManualAnimationFrame: 38 };
const ANGLE = new Set([F.Roll, F.RollSpeed, F.Yaw, F.Pitch]);
const field = (v, d) => (v === undefined ? d : typeof v === 'number' ? v : F[String(v).replace(/^PARTICLE_ATTRIBUTE_/, '')] ?? d);

export const SOURCE_TO_GLTF = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2, 'YXZ')), new THREE.Vector3(0.0254, 0.0254, 0.0254));

// ---------------------------------------------------------------- random, noise, maths
const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
const rnd = Math.random;
const lerp = (a, b, t) => a + (b - a) * t;
const saturate = (x) => Math.min(1, Math.max(0, x));
const remap = (x, a, b) => (b === a ? (x >= b ? 1 : 0) : (x - a) / (b - a));
const remapClamped = (x, a, b, c, d) => lerp(c, d, saturate(remap(x, a, b)));
const bias = (x, b) => x / ((1 / b - 2) * (1 - x) + 1);
// ParticleMath.BiasFromParameter (Source 2 Viewer): the parameter runs from -1 to 1, 0 leaving the
// value as it is; exponential bias makes it an exponent from 20 down to 0.
function biasFrom(x, p, type) {
  if (type === 'PF_BIAS_TYPE_EXPONENTIAL') {
    const e = p >= 0 ? 1 - saturate(p) : 20 - saturate(p + 1) * 19;
    return e <= 0 || x >= 1 ? 1 : x <= 0 ? 0 : Math.pow(x, Math.min(e, 20));
  }
  if (type !== 'PF_BIAS_TYPE_STANDARD' && type !== 'PF_BIAS_TYPE_GAIN') return 0;
  const b = saturate((p + 1) * 0.5); if (b <= 0) return 0; if (b >= 1) return 1;
  if (type === 'PF_BIAS_TYPE_GAIN') return x < 0.5 ? bias(x + x, b) * 0.5 : 1 - bias(2 - x - x, b) * 0.5;
  return bias(x, b);
}
const withExponent = (exp, a, b) => lerp(a, b, exp === 1 ? rnd() : Math.pow(rnd(), exp));
const vec = (a, d = [0, 0, 0]) => new THREE.Vector3(...(Array.isArray(a) ? a : d));
function inUnitBall() { for (;;) { const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); const l = v.lengthSq(); if (l <= 1 && l > 1e-8) return { v: v.clone().normalize(), fraction: Math.cbrt(l) }; } }
// Improved Perlin noise, roughly [-1, 1].
const P = new Uint8Array(512); { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(hash(i, 7) * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h, x, y, z) => { const u = (h & 15) < 8 ? x : y, v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255; x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z), A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}
const noiseV = (p) => noise3(p.x, p.y, p.z);
// The engine's own noise (Source 2 Viewer's Noise): value lattices whose corners come from an integer
// hash of the corner, blended without smoothing; curl noise from its table-driven vector lattice.
const rotl = (x, r) => (x << r) | (x >>> (32 - r));
const corner = (x, y, z) => Math.imul(rotl(Math.imul((x + (y << 10) + (z << 20)) | 0, 0xcc9e2d51) & 0x7fffffff, 15), 0x1b873593) & 0x7fffffff;
const valueHash = (x, y, z) => { const h = (Math.imul(rotl(corner(x, y, z), 13), 5) + 0xe6546b64) | 0, m = Math.imul((h ^ (h >> 16)) & 0x7fffffff, 0x04b2ae35); return ((m ^ (m >> 16)) & 0xffff) / 65535; };
// One hash gives all three components, from three of its bytes.
const vectorHash = (x, y, z) => { let m = Math.imul(rotl(corner(x, y, z), 13) & 0x7fffffff, 0x04b2ae35); m ^= m >> 16; return new THREE.Vector3((m & 255) * 2 / 255 - 1, ((m >> 8) & 255) * 2 / 255 - 1, ((m >> 16) & 255) * 2 / 255 - 1); };
function value3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, h = valueHash, row = (j, k) => lerp(h(ix, j, k), h(ix + 1, j, k), fx);
  return (lerp(lerp(row(iy, iz), row(iy + 1, iz), fy), lerp(row(iy, iz + 1), row(iy + 1, iz + 1), fy), z - iz) - 0.5) * 2;
}
function valueVector(p) {
  const ix = Math.floor(p.x), iy = Math.floor(p.y), iz = Math.floor(p.z), fx = p.x - ix, fy = p.y - iy, h = vectorHash, row = (j, k) => h(ix, j, k).lerp(h(ix + 1, j, k), fx);
  return row(iy, iz).lerp(row(iy + 1, iz), fy).lerp(row(iy, iz + 1).lerp(row(iy + 1, iz + 1), fy), p.z - iz);
}
// The curl lattice (NoiseTables): 256 float32 vectors, and the X, Y and Z permutations of 256 each.
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const CURL = new Float32Array(bytes('hpDrvsYwY79DAHC9xZLqvtWUXD8HQNy+HzFuvwvRoT4aMEi+2zBiv+pcyb72l42+LSEvPrXDe78D0Ki+2IMJvTIecb/+t36/wvbzvrTkcTz5D2E/ibRVP4i96L4EkLI+DvcVv/RTSL/8b62+aVd5P7HBwrwL0GY+S1p9vylaObznbxK+5dEBPzeIVr8NAL2+oigcv7sqRL8D0KA+QifcPsWPGT8E5Fe/ZHm3PTJxZ7/9T3q/ti6dvj/EZr/+fzQ/S3UBPQiqfj8GaHO/pDNMP1piJb79uxa//MJPP0ZfAb8K+K0+N6ZvP8Dt6b0GaKs+pn5ePjljeL8GoOE+kNkZPzVeNr/4MwS/ea9KPsmwej8CoFo+c7lBO6z/fz/xR4m+1qppv4FdrT0AWM2+1ehFvk0Tcr/7602/SpgpP0PhIz8GoAG/TBe6PphqYr/8jyA/kujdvvNzLz8CuE0/L744v7x61T79oxu/GM4lPxDplz77Hzw/Jhk5P4F6477+Jxc/nmA3v0JD174IIB2/KA4gvfAXf78ArGI/L24zPmoWeL/4MzQ/iITvPbTofb8FUMy+UTIBv6xTZbz8/1w/GmvfvvFiUb/51yY/9MPIPTi+fr/w3ww+uRwjP5waRL/0bwe+cD8Yv4RJFT/6Yy6/aykgv9b+1j77czm/s3obv6j+yb78G0A/kdOfvsDsMj/8U2Y/oFDPPalnbb8IdHa/aypvvwPQKD35h7W+EHVTvwfOkb775wG/kj26vsHlbb8BwDG+CagQvtfeez/5Dx2/nE3fvs45mL0AOGY/RBdgv4gw9r7Xv2s9ll2APgH2kT0IyHc/jYA6Pk28Tz/7P3M/2Awwv2cnK7/518K+OwFJP6ZICr/3P7i+La/MPgA5WT/6tyc/hBHTvmDMlrsEPGk/B1wHvm2Qfb/4b44+5IRZPjyhQz8CuHE/huMxv7Wobz4CDDO/3/zOPsCWZz/4/6G+Sn+3PtZzsj35224/OWHyvj8eUj/6Rw+/v/Q2Pd14f78F3Dc/7pgaPz//Pb0D7Es/uAR4vydPOT75LzA++pnqvvoNYz8UQAG+FR4ov1UV0r4GoDE/6N5/P/ikk7zUf9Y8Cd74vk58Pb8A5DC/EEFxP1Pqqr4iALg8ms6WvkccXj//P04/vARjP5II1b7ij2K+chRMv/RwFj8hIC++HSIev/pHQ7/2X5e+VhHmPnaJWr/8bwG/8G6FPWLbfr8EPDk/zht/PwAAAAD9v6o9SdWGPvKUtT0I5Ha/qaBivouKeL8FUMQ+IjcDv4oDOD/+8yw/d78WP6MF0D75v0O/hshNv7a/F7+EgHy9ADZcPyBd/D4c8Bm+cCi0vnanWz8HfDo/fQYEP5utUL/3H+k+9YP6vUjidb/582U/220Hv2stWD/rjyC+DtoHP4atOb8BFCM/5bg/v/vmfr78UyK/Bp1AvrqGFT/7B3k/4WJ5P5xsYz7O/yu9SWcYPzCgM7/4pwy/Hed2vQKAf7/6X4a+SUhEvkpESL//k3O/x2IHPxqoGL/6l0A/0LQcP6q6Iz/52xq/Yf9hP59aTT4IAN4+6q9vv0TAIb3517I+attwPxwj+b0QIKM+qJDrvexpRz39S36/kPilvr2Lb7/+18m+L/1vv/Tglr4VkEY+h/tkP4fd374IINU9VaJcv4AQKb7+7/i+vQB7v69BD77n3w4+1qvIvLbzdT8EAH+/eSMzv3vZNj9JgJq8DeAJP4bHSr/+7/A+n66ePqKXcb/8x7I+YJIGPyS0Rb/5vw8/OgdLv/KYiT4CSBE/n48yP3ye1779oyM/HeU8v28sLD/r/5y94BLIvusaZb//H/e+lu0Xv1Z/RD4E5Es/SfbgPpiKZb8MIPw9weasPkYmNL8EPGG/kZknv1ngPz/tnxc+4dH2vn1YM78FwDw/LIEgPwYPQz/0T4C+hNgdP25Qezz5h0m/Ghk0vlpke7//r7o+OzhkPwEwpr7wF6u+yqdbPzBl4D4OiJi+2QlzP8x7hD7w3zw+RPvYPe6zZr8IPHg/8u2Fvol6cT8FqB2/rpsuvzpBB78AdBi/QpRPv0GcAz8H8Ka+6q8nvjtyfD/pfyk+rI4Yv5c7Y74CoEo/FTkkvt8zer8EBCc/hpDbvrxBJD8HQFS/l1civ4oG+b78GzC/3gS/vd7Gfr/2X5e+whh9P1m/Gb4dAVy7Fhc7P7Cq/r767wm/cytIv+UKH78XgIa9BOgnvx/ZQL/Uf5a9cXVYP8V00b4PgMA+XkohvyDSA78HmC2/NIFSPsKHej96/5+8ETUVP8uAQz8KMNy+qmEvP558Or8AAAAAQzt3vqtbdb8BbAi/HOw9P2E0qzz+myu/iII9P+YGo74E6B8/BvI8v5f+Cb8QsPY+ij53v0NYDb38p4O+woj9PtwsTj8GuAw/75ASvzE/Tz/sT2K+soQJv8GrVT/zH2I+bVVmv/9YyD36z9q+CoS9vjj2/D79o2c/dR02P1zjEz/xD/s+Sbk7PtUIOb/603a/SYUNP+fITr/+17G+3bXEvdCbfj/0p8W+RIliv9MzvT4JOJw+6j1VvzBJDb+1/0E9E4KtPgBVJD8FpGU/ritOP3mVAT/+J7c+Ql0kva+xfz8CKBK/4A/vPn46Gr/9n08/iIEOPpHTe78DJCI/fO2BvsFVrr4GgHa/5snlvrsLWD8IPAw/IO1bv1CK3r4FqJm+YDyTPkUpdT98f0M9ZRnCPqGGSz8G2Ec/Z/IdPjbnfL/NH9O9wr4Jv2x3Sz/yz+y+MdPuvidPOb7+X2E/I/QzvhfYe78VcE8+gUNkv5+wRD4N4NW+sU8wvwx3Hr8FGPY+v2D3PVjjfL8HJCG/i8OZvR+/ez/5E2k/jo8WPs7edb/9a1m/mng7P0rrKz8T8Bs+AP5NP1M+jD74Nwy/tW3IPlX6ab8OwIY+kzoRvxR7SD8CuNE+NBNcPsIxKz7+13m/hh+8Ph09Sr/+70y/uOWjvnqoaT8BFB+/acQoP3i4Jb/+ewC/sTBkPq5KMr8IWHO/NpAyv/SGE7/9ZwU/ti0aP4aOQb/xZ8g+9KftvXIxfj/9n1M+Wf1hPuIGeL/4N+i++uw8PxmOKz9AwNo9Wi5LPrlTMr8IBHY/qaLIvuAvYr/4Mww/vhKoPdEHf7/5D6k+4llOv+zZ+z4JiMG+FAV+v4Mw9z1WgO88wjDQPg4WXr8EcBM/1jlKP3/AGz/J/8Q93CoIvyY3irsEyFi/nuwOP4Elt70AAFQ/2XxIv6pHuj4DmAq/FlF7Px+gO76lv1c9FvzGvp+taz84oMW9oaMBv4DvNr0IrFy/Bi4Dv4ogWr8bEFG+JT4PP0D3rT4AxE0/XwoHP/OsWL/w3ww+Er08vsnlc78ChEs/SwYAPuIjer//H0+/4Lwkv9S6LT8L0PY+EhGOvgQ9dD/0N8E+N1Efv9W0N78O2OU+PdO7Pvfn4r37622/U5X2PcUafj8L0AY+tqB7vwYS1D35nxy+le5uvTp3f7//l9u+bNAHPlezej/+Y0E/ox2nPg4UcD/5Z64+Ic1YPlMGej/3ryw+dSJ1P8sSnbwKSJO+QZyHvBDpfz/6s0c/nN2KvmnJUz/5L2C/YM1ZP01p5b4DQJ0+q3btPcyZGT8BTH2/eF6SPo/ecL8CSAm/qYOkvg6Cjr4DQHG/0SHYvnAjQT//B0Q/wW8rPwPqPb9YAFO9ArtaPtwrc78I6Do/aqMeP9V1QL8EAK++3iFlvkeS4D4C8He//Bibvn4bcr/xR7k+m//3PZEmer/6Y1K/Di0CPtI6Qj8BFHu/EhIxP4wUMj8MWIo+l+Z2Pqirdz8PKJu+jGdUv0mC2D4N4M0+IeX3vo/hPb8HKDE/+83cvrcJR7/8Uzq/G/RVP9wSWb4IsAQ/SG+YPqHYbj8G1A8/aysiP8zRQ7/rbzm+IXdVvy436L70v7S+Uia9vsjuVj/7rzu//UsOP6UuyT4C8Eu/Eydbv7By6Dz6KwQ/tYuJPWtgfz/674k+61d2v8L2U73+74g+Fyg9vx75oz0G1Cu/zqpDv7mq7D7/ywE/BFQYPkFlQD/9Z3k/wRwdvgvvor75n3w/XvXgvnrCRj8BiDc/').buffer);
const PERM = bytes('QpNq1Vlz7xmrrwlyjeJ2gCnQBDi0+CtS9tte9YWD3meggqiR7iYXBuxDYwJG6FDRAQNEQWbSDUk3/LuqFiQ0tXWjLk+m4JRLcV+cudykM46hI877LYjFvoQg2n8/G4ld8hS9bLd6i7/5/VdiRQCQQBjWYXSeKmsPNdRTb5jwSu0+Tc2VGpeyzFuw6jGayyHdfYalfFYnJTyWnbNtbiyfmQVkCs8oumDXj6LmuGU2rvdMO/HfwFRoTqmSih4wVekTHVx+Ecf6H1G84RxwWAu2rdOBwqwOeMinhwyx4+WbyT1pw8H06zoIxHv+EBIyeUfzWjnKd/8vB8bkFdnY54xIIntsyUAoSxjdiW6/jglF5lMH9zM2c4W0+G10PmP7N1n9QWrkp4OEOo9hZqPKleoMda5eeUogcRQ8n7bMHfR2A7L/JgZyJF0ehtVa9dFY6KJ9VKZGiNDnG0edUEwAquHLsCGhxID87PYCigH6xU3z2vITpETUDu2QPy5nsbxV3wig3gTY2yMPLBd+f2Ti6yWoZTEWC0k9h2+3SGC571ISMpu6mRHpkpxrBf4KwMaUz2gNfDBfgXjOx1H5W5bSd/B6wlwiHM2v47PcjJhPGsMvQq2p8TW4u5Fw7taTYqvlyJcZQ0692YLgOaw7KSsQaZ6lFS04jYvXvlYqNCdXtR+awdNhQWAZehrbVZT7ZgCMgojVijzsNLKDc7eQTpOoJy2pRjmSQ4782Bw2Vt7CyDAFzX3WOLX/xJsl2pnQQvJJ+M49PvaxAsVrophZKQagXgjJJuvkpV1v70rneS+m3Z1ATfQdaZZ7vr/hdoUqClS5n3yE8LQsAQkTY/4Mz7pH6rgLFBDBi69iO3EbquZbuy6c+WzDq3IOvFLA6Rgg8VekWiuj9Vwo1zfiDwNwnvqsFuOJI4CR96F3UNm9UQc/ynjfU7MEasflXzUyIbZIjxfzSxKtjafGzDqu7RGB7n8fZbAkHm7RIsuH6ESVMYZ+1E9MdWjS0+D9ZNxtdFgNl5pFFTNn');
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer), bits = (x) => { f32[0] = x; return u32[0]; };
const curlVector = (cell) => { const i = PERM[512 + cell] * 3; return new THREE.Vector3(CURL[i], CURL[i + 1], CURL[i + 2]); };
// Coordinates in 8.8 fixed point from the float's bits after a +32768 bias: the lattice repeats every 256 units.
function curlSample(p) {
  const bx = bits(p.x + 32768) & 0xffff, by = bits(p.y + 32768) & 0xffff, bz = bits(p.z + 32768) & 0xffff, ix = bx >> 8, iy = by >> 8, iz = bz >> 8, fx = (bx & 255) / 256;
  const r0 = (PERM[ix] + iy) & 255, r1 = (PERM[(ix + 1) & 255] + iy) & 255, cell = (r, k) => (PERM[256 + ((r + k) & 255)] + iz) & 255;
  const c00 = cell(r0, 0), c01 = cell(r0, 1), c10 = cell(r1, 0), c11 = cell(r1, 1), x = (a, b, k) => curlVector((a + k) & 255).lerp(curlVector((b + k) & 255), fx), fy = (by & 255) / 256;
  return x(c00, c10, 0).lerp(x(c01, c11, 0), fy).lerp(x(c00, c10, 1).lerp(x(c01, c11, 1), fy), (bz & 255) / 256);
}
function curl3(p) {
  const a = curlSample(p), q = p.clone().add(new THREE.Vector3(43.256, -67.89, 1338.2)), b = curlSample(q), c = curlSample(q.add(new THREE.Vector3(-129.856, -967.23, 2338.98)));
  return new THREE.Vector3(c.y - b.z, a.z - c.x, b.x - a.y);
}
// The offset to the nearest jittered feature point of the 27 cells around; the seed's float bits seed the hash.
function worleyOffset(p, jitter, offset) {
  const seed = bits(offset) | 0, ix = Math.floor(p.x), iy = Math.floor(p.y), iz = Math.floor(p.z), best = new THREE.Vector3(); let near = Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    let h = Math.imul(ix + i + ((iy + j) << 10) + ((iz + k) << 20) | 0, 0xcc9e2d51) & 0x7fffffff; h = (Math.imul(rotl(h, 15), 0x1b873593) & 0x7fffffff) ^ seed;
    h = Math.imul(((h >> 19) | (h << 13)) & 0x7fffffff, 0x04b2ae35); h ^= h >> 16;
    const x = (h & 255) / 255 * jitter + i - (p.x - ix), y = ((h >> 8) & 255) / 255 * jitter + j - (p.y - iy), z = ((h >> 16) & 255) / 255 * jitter + k - (p.z - iz), dd = x * x + y * y + z * z;
    if (dd < near) { near = dd; best.set(x, y, z); }
  }
  return best;
}

// ---------------------------------------------------------------- particles
class Particle {
  constructor(c) {
    this.pos = new THREE.Vector3(); this.prev = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.force = new THREE.Vector3();
    this.age = 0; this.life = c.life; this.alpha = c.alpha; this.alpha2 = 1; this.color = c.color.clone(); this.radius = c.radius; this.trail = 0.1;
    this.rot = new THREE.Vector3(0, 0, c.roll); this.rotSpeed = new THREE.Vector3(0, 0, c.rollSpeed); this.normal = new THREE.Vector3(0, 0, 1);
    this.seq = c.seq; this.seq2 = 0; this.created = 0; this.forceScale = 1; this.s = [0, 0, 0]; this.sv = new THREE.Vector3(); this.sv2 = new THREE.Vector3(); this.hbo = new THREE.Vector3();
    this.id = 0; this.uid = 0; this.index = 0; this.dead = false; this.initial = null; this.bone = null; this.surface = null; this.snap = -1; this.snapFrom = null; this.orient = null;
  }
  get nage() { return this.age / Math.max(1e-4, this.life); }
  getS(f) {
    switch (f) {
      case F.LifeDuration: return this.life; case F.Radius: return this.radius; case F.Roll: return this.rot.z; case F.RollSpeed: return this.rotSpeed.z;
      case F.Alpha: return this.alpha; case F.CreationTime: return this.created; case F.SequenceNumber: return this.seq; case F.TrailLength: return this.trail;
      case F.ParticleId: return this.id; case F.Yaw: return this.rot.x; case F.SecondSequenceNumber: return this.seq2; case F.AlphaAlternate: return this.alpha2;
      case F.ScratchFloat: return this.s[0]; case F.ScratchFloat1: return this.s[1]; case F.ScratchFloat2: return this.s[2]; case F.Pitch: return this.rot.y;
      case F.ForceScale: return this.forceScale; default: return 0;
    }
  }
  setS(f, v) {
    switch (f) {
      case F.LifeDuration: this.life = v; break; case F.Radius: this.radius = v; break; case F.Roll: this.rot.z = v; break; case F.RollSpeed: this.rotSpeed.z = v; break;
      case F.Alpha: this.alpha = v; break; case F.CreationTime: this.created = v; break; case F.SequenceNumber: this.seq = Math.round(v); break; case F.TrailLength: this.trail = v; break;
      case F.Yaw: this.rot.x = v; break; case F.SecondSequenceNumber: this.seq2 = Math.round(v); break; case F.AlphaAlternate: this.alpha2 = v; break;
      case F.ScratchFloat: this.s[0] = v; break; case F.ScratchFloat1: this.s[1] = v; break; case F.ScratchFloat2: this.s[2] = v; break; case F.Pitch: this.rot.y = v; break;
      case F.ForceScale: this.forceScale = v; break;
    }
  }
  getV(f) { switch (f) { case F.Position: return this.pos; case F.PositionPrevious: return this.prev; case F.Color: return this.color; case F.Normal: return this.normal; case F.ScratchVector: return this.sv; case F.ScratchVector2: return this.sv2; case F.HitboxOffsetPosition: return this.hbo; default: return new THREE.Vector3(); } }
  setV(f, v) { const t = this.getV(f); if (f === F.Normal && v.lengthSq() === 0) return; t.copy(v); }
  initS(f) { return this.initial ? this.initial.getS(f) : this.getS(f); }
  initV(f) { return this.initial ? this.initial.getV(f) : this.getV(f); }
  snapshot() { const c = Object.assign(Object.create(Particle.prototype), this); c.pos = this.pos.clone(); c.prev = this.prev.clone(); c.color = this.color.clone(); c.normal = this.normal.clone(); c.rot = this.rot.clone(); c.rotSpeed = this.rotSpeed.clone(); c.hbo = this.hbo.clone(); c.initial = null; return c; }
}
function setMethod(p, f, value, method, dt = 0) {
  switch (method) {
    case 'PARTICLE_SET_SCALE_INITIAL_VALUE': return p.initS(f) * value;
    case 'PARTICLE_SET_ADD_TO_INITIAL_VALUE': return p.initS(f) + value;
    case 'PARTICLE_SET_SCALE_CURRENT_VALUE': return p.getS(f) * value;
    case 'PARTICLE_SET_ADD_TO_CURRENT_VALUE': return p.getS(f) + value;
    case 'PARTICLE_SET_RAMP_CURRENT_VALUE': return p.getS(f) + value * dt;
    default: return value;
  }
}
// The same for vectors; at spawn (an initializer) the initial value is the current one.
function setVMethod(p, f, v, method, dt = 0, spawn = false) {
  const cur = p.getV(f).clone(), init = spawn ? cur : p.initV(f).clone();
  switch (method) {
    case 'PARTICLE_SET_SCALE_INITIAL_VALUE': return init.multiply(v);
    case 'PARTICLE_SET_ADD_TO_INITIAL_VALUE': return init.add(v);
    case 'PARTICLE_SET_SCALE_CURRENT_VALUE': return cur.multiply(v);
    case 'PARTICLE_SET_ADD_TO_CURRENT_VALUE': return cur.add(v);
    case 'PARTICLE_SET_RAMP_CURRENT_VALUE': return cur.addScaledVector(v, dt);
    default: return v.clone();
  }
}
const VECTOR = new Set([F.Position, F.PositionPrevious, F.Color, F.HitboxOffsetPosition, F.ScratchVector, F.Normal, F.GlowRgb, F.ScratchVector2]);

// ---------------------------------------------------------------- providers
function number(d, def = 0) {
  if (d === undefined || d === null) return () => def;
  if (typeof d === 'number') return () => d;
  if (typeof d !== 'object') return () => def;
  const map = mapping(d);
  switch (d.m_nType) {
    case 'PF_TYPE_LITERAL': { const v = d.m_flLiteralValue ?? 0; return () => v; }
    case 'PF_TYPE_RANDOM_UNIFORM': case 'PF_TYPE_RANDOM_BIASED': {
      const a = d.m_flRandomMin ?? 0, b = d.m_flRandomMax ?? 0, varying = d.m_nRandomMode === 'PF_RANDOM_MODE_VARYING', salt = (number.salt = (number.salt || 0) + 1);
      const biased = d.m_nType === 'PF_TYPE_RANDOM_BIASED', bp = d.m_flBiasParameter ?? 0, bt = d.m_nBiasType || 'PF_BIAS_TYPE_STANDARD';
      const flip = d.m_bHasRandomSignFlip;
      return (p) => { let r = varying || !p ? rnd() : hash(p.uid + p.sys.seed, salt); if (biased) r = biasFrom(r, bp, bt);
        const v = lerp(a, b, r); if (!flip) return v; const f = varying || !p ? rnd() : hash(p.uid + p.sys.seed, salt + 37); return f < 0.5 ? -v : v; };
    }
    case 'PF_TYPE_PARTICLE_FLOAT': case 'PF_TYPE_PARTICLE_INITIAL_FLOAT': { const f = field(d.m_nScalarAttribute, F.Radius); return (p) => map(p ? p.getS(f) : 0); }
    case 'PF_TYPE_PARTICLE_AGE': return (p) => map(p ? p.age : 0);
    case 'PF_TYPE_PARTICLE_AGE_NORMALIZED': return (p) => map(p ? p.nage : 0);
    case 'PF_TYPE_COLLECTION_AGE': return (p, s) => map(s ? s.age : 0);
    case 'PF_TYPE_CONTROL_POINT_COMPONENT': { const cp = d.m_nControlPoint ?? 0, c = d.m_nVectorComponent ?? 0; return (p, s) => map(s ? s.cp(cp).pos.getComponent(Math.min(2, c)) : 0); }
    case 'PF_TYPE_PARTICLE_NUMBER': return (p) => map(p ? p.uid : 0);
    default: return () => d.m_flLiteralValue ?? def;
  }
}
function mapping(d) {
  switch (d.m_nMapType) {
    case 'PF_MAP_TYPE_MULT': { const m = d.m_flMultFactor ?? 0; return (x) => x * m; }
    case 'PF_MAP_TYPE_REMAP': { let [i0, i1, o0, o1] = [d.m_flInput0 ?? 0, d.m_flInput1 ?? 0, d.m_flOutput0 ?? 0, d.m_flOutput1 ?? 0]; if (i0 > i1) [i0, i1, o0, o1] = [i1, i0, o1, o0];
      return (x) => (i0 === i1 ? (x >= i1 ? o1 : o0) : remapClamped(x, i0, i1, o0, o1)); }
    case 'PF_MAP_TYPE_CURVE': return curve(d.m_Curve, d.m_nInputMode === 'PF_INPUT_MODE_LOOPED');
    default: return (x) => x;
  }
}
// A piecewise curve: Hermite between its keys with their slopes, the end keys' values beyond them
// (Marci's taunt basket grows to size 1 in 0.1 s and stays so); a looped input wraps in the domain.
function curve(c, looped) {
  const keys = c?.m_spline || []; if (!keys.length) return (x) => x;
  const d0 = c.m_vDomainMins?.[0] ?? 0, d1 = c.m_vDomainMaxs?.[0] ?? 0, span = d1 - d0;
  return (x) => {
    if (looped && span > 0) x = d0 + ((((x - d0) % span) + span) % span);
    if (x <= keys[0].x) return keys[0].y;
    const last = keys[keys.length - 1]; if (x >= last.x) return last.y;
    let i = 0; while (keys[i + 1].x < x) i++;
    const a = keys[i], b = keys[i + 1], h = b.x - a.x; if (h <= 0) return b.y;
    const t = (x - a.x) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * h * (a.m_flSlopeOutgoing ?? 0) + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * h * (b.m_flSlopeIncoming ?? 0);
  };
}
function vector(d, def = [0, 0, 0]) {
  if (d === undefined || d === null) { const v = vec(def); return () => v; }
  if (Array.isArray(d)) { const v = vec(d); return () => v; }
  switch (d.m_nType) {
    case 'PVEC_TYPE_LITERAL': { const v = vec(d.m_vLiteralValue); return () => v; }
    case 'PVEC_TYPE_PARTICLE_VECTOR': case 'PVEC_TYPE_PARTICLE_INITIAL_VECTOR': {
      const f = field(d.m_nVectorAttribute, F.Position), k = vec(d.m_vVectorAttributeScale, [1, 1, 1]), initial = d.m_nType === 'PVEC_TYPE_PARTICLE_INITIAL_VECTOR';
      return (p) => (p ? (initial && p.initial ? p.initial : p).getV(f).clone().multiply(k) : new THREE.Vector3());
    }
    case 'PVEC_TYPE_CP_VALUE': { const cp = d.m_nControlPoint ?? 0, k = vec(d.m_vCPValueScale, [1, 1, 1]); return (p, s) => s.cp(cp).pos.clone().multiply(k); }
    case 'PVEC_TYPE_CP_DELTA': { const cp = d.m_nControlPoint ?? 0, other = d.m_nDeltaControlPoint ?? 0, k = vec(d.m_vCPValueScale, [1, 1, 1]); return (p, s) => s.cp(cp).pos.clone().sub(s.cp(other).pos).multiply(k); }
    // A point or a direction in a control point's own space.
    case 'PVEC_TYPE_CP_RELATIVE_POSITION': { const cp = d.m_nControlPoint ?? 0, v = vec(d.m_vCPRelativePosition); return (p, s) => v.clone().applyMatrix4(s.cp(cp).matrix()); }
    case 'PVEC_TYPE_CP_RELATIVE_DIR': { const cp = d.m_nControlPoint ?? 0, v = vec(d.m_vCPRelativeDir, [1, 0, 0]); return (p, s) => v.clone().applyQuaternion(s.cp(cp).quat); }
    case 'PVEC_TYPE_LITERAL_COLOR': { const c = d.m_LiteralColor || [255, 255, 255]; const v = new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255); return () => v; }
    // Random between two corners, one draw per particle (as the floats' constant random mode), plus the literal.
    case 'PVEC_TYPE_RANDOM_UNIFORM': case 'PVEC_TYPE_RANDOM_UNIFORM_OFFSET': {
      const lo = vec(d.m_vRandomMin), hi = vec(d.m_vRandomMax), base = d.m_nType === 'PVEC_TYPE_RANDOM_UNIFORM_OFFSET' ? vec(d.m_vLiteralValue) : new THREE.Vector3(), salt = (number.salt = (number.salt || 0) + 3);
      return (p) => { const r = (k) => (p ? hash(p.uid + p.sys.seed, salt + k) : rnd()); return new THREE.Vector3(lerp(lo.x, hi.x, r(0)), lerp(lo.y, hi.y, r(1)), lerp(lo.z, hi.z, r(2))).add(base); };
    }
    case 'PVEC_TYPE_FLOAT_COMPONENTS': { const x = number(d.m_FloatComponentX), y = number(d.m_FloatComponentY), z = number(d.m_FloatComponentZ); return (p, s) => new THREE.Vector3(x(p, s), y(p, s), z(p, s)); }
    // A float mapped onto a line between two vectors (clamped to it or not), or onto a colour gradient.
    case 'PVEC_TYPE_FLOAT_INTERP_CLAMPED': case 'PVEC_TYPE_FLOAT_INTERP_OPEN': case 'PVEC_TYPE_FLOAT_INTERP_GRADIENT': {
      const f = number(d.m_FloatInterp), i0 = d.m_flInterpInput0 ?? 0, i1 = d.m_flInterpInput1 ?? 1, o0 = vec(d.m_vInterpOutput0), o1 = vec(d.m_vInterpOutput1, [1, 1, 1]);
      const t = (p, s) => { const x = i1 === i0 ? 0 : (f(p, s) - i0) / (i1 - i0); return d.m_nType === 'PVEC_TYPE_FLOAT_INTERP_OPEN' ? x : saturate(x); };
      if (d.m_nType !== 'PVEC_TYPE_FLOAT_INTERP_GRADIENT') return (p, s) => o0.clone().lerp(o1, t(p, s));
      const stops = (d.m_Gradient?.m_Stops || []).map((g) => ({ at: g.m_flPosition ?? 0, c: new THREE.Vector3(...(g.m_Color || [255, 255, 255]).slice(0, 3)).divideScalar(255) })).sort((a, b) => a.at - b.at);
      if (!stops.length) return () => new THREE.Vector3(1, 1, 1);
      return (p, s) => { const x = t(p, s); if (x <= stops[0].at) return stops[0].c.clone(); for (let i = 1; i < stops.length; i++) if (x <= stops[i].at) { const a = stops[i - 1], b = stops[i]; return a.c.clone().lerp(b.c, b.at > a.at ? (x - a.at) / (b.at - a.at) : 1); } return stops[stops.length - 1].c.clone(); };
    }
    default: { const v = vec(d.m_vLiteralValue, def); return () => v; }
  }
}
// A control point's transform (Source space), for m_TransformInput or a plain control point number.
function transform(d, cpDefault = 0) {
  const cp = d && typeof d === 'object' ? (d.m_nControlPoint ?? cpDefault) : cpDefault;
  return (s) => s.cp(cp).matrix();
}

// ---------------------------------------------------------------- functions
const endcapSkip = (d) => d.m_nOpEndCapState === 'PARTICLE_ENDCAP_ENDCAP_ON';
// When an operator runs: always, only in the end cap (after the effect is stopped), or only before it.
const endcapState = (d) => ({ PARTICLE_ENDCAP_ENDCAP_ON: true, PARTICLE_ENDCAP_ENDCAP_OFF: false })[d.m_nOpEndCapState] ?? null;
// ParticleFunction.GetOperatorRunStrength: m_flOpStrength times the operator's fade-in/out window.
function strength(d) {
  const inS = d.m_flOpStartFadeInTime ?? 0, inE0 = d.m_flOpEndFadeInTime ?? 0, outS0 = d.m_flOpStartFadeOutTime ?? 0, outE0 = d.m_flOpEndFadeOutTime ?? 0, period = d.m_flOpFadeOscillatePeriod ?? 0;
  const op = number(d.m_flOpStrength, 1), unity = !inS && !inE0 && !outS0 && !outE0;
  const inE = Math.max(inE0, inS), outS = Math.max(outS0, inE), outE = Math.max(outE0, outS);
  return (s) => {
    const k = op(null, s); if (unity || k <= 0) return k;
    let t = s.age; if (period > 0) t = (t / period) % 1;
    if (inS > t) return 0; if (outE0 > 0 && outE0 < t) return 0;
    let v = 1; if (inE > t && inE > inS) v = Math.min(v, (t - inS) / (inE - inS)); if (t > outS && outE > outS) v = Math.min(v, (outE - t) / (outE - outS));
    return Math.max(0, k) * v;
  };
}

// The fields each initializer writes (ParticleFunctionInitializer.WrittenFields).
function writes(d) {
  const POS = [F.Position, F.PositionPrevious];
  switch (d._class) {
    case 'C_INIT_InitFloat': return [field(d.m_nOutputField, F.Radius)];
    case 'C_INIT_InitVec': return [field(d.m_nOutputField, F.Color)];
    case 'C_INIT_RandomColor': return [field(d.m_nFieldOutput, F.Color)];
    case 'C_INIT_RandomSequence': return [F.SequenceNumber];
    case 'C_INIT_RandomYawFlip': return [F.Yaw];
    case 'C_INIT_InitialVelocityNoise': return [F.PositionPrevious];
    case 'C_INIT_NormalAlignToCP': return [F.Normal];
    case 'C_INIT_RemapParticleCountToScalar': case 'C_INIT_DistanceToCPInit': return [field(d.m_nFieldOutput, F.Radius)];
    case 'C_INIT_CreationNoise': case 'C_INIT_InheritFromParentParticles': case 'C_INIT_RemapInitialCPDirectionToRotation': return [field(d.m_nFieldOutput, d._class === 'C_INIT_CreationNoise' ? F.Radius : F.Roll)];
    case 'C_INIT_RemapCPOrientationToRotations': return [F.Roll, F.Yaw, F.Pitch];
    case 'C_INIT_InitFromCPSnapshot': { const a = field(d.m_nAttributeToWrite ?? d.m_nAttributeToRead, F.Position); return a === F.Position ? POS : [a]; }
    case 'C_INIT_CreateSequentialPath': case 'C_INIT_CreateSequentialPathV2': case 'C_INIT_CreateAlongPath': return [...POS, F.HitboxOffsetPosition];
    case 'C_INIT_GlobalScale': return [...POS, F.Radius, F.HitboxOffsetPosition];
    case 'C_INIT_CreateFromCPs': return [...POS, F.LifeDuration];
    case 'C_INIT_SequenceLifeTime': return [F.LifeDuration];
    // The emitter counts creation time as written: below behaviour version 6 this one never runs.
    case 'C_INIT_AgeNoise': return [F.CreationTime];
    case 'C_INIT_VelocityFromCP': case 'C_INIT_VelocityRadialRandom': return [F.PositionPrevious];
    case 'C_INIT_RemapScalarToVector': case 'C_INIT_RemapTransformToVector': return [field(d.m_nFieldOutput, F.Position), F.PositionPrevious];
    case 'C_INIT_InitFloatCollection': return [field(d.m_nOutputField, F.Radius)];
    case 'C_INIT_RandomVectorComponent': case 'C_INIT_RemapInitialDirectionToTransformToVector': return [field(d.m_nFieldOutput, F.Position)];
    case 'C_INIT_RemapInitialTransformDirectionToRotation': return [field(d.m_nFieldOutput, F.Yaw)];
    case 'C_INIT_RemapTransformOrientationToRotations': return d.m_bWriteNormal ? [F.Normal] : [F.Roll, F.Yaw, F.Pitch];
    default: return POS;
  }
}
const INIT = {
  C_INIT_InitFloat(d) {
    const out = field(d.m_nOutputField, F.Radius), value = number(d.m_InputValue), method = d.m_nSetMethod, str = number(d.m_InputStrength, 1);
    return (p, s) => { let v = value(p, s); if (ANGLE.has(out) && !/SCALE/.test(method || '')) v *= Math.PI / 180; const t = setMethod(p, out, v, method); p.setS(out, lerp(p.getS(out), t, str(p, s))); };
  },
  C_INIT_InitVec(d) { const out = field(d.m_nOutputField, F.Color), value = vector(d.m_InputValue); return (p, s) => p.setV(out, value(p, s)); },
  C_INIT_RandomColor(d) {
    const a = d.m_ColorMin || [255, 255, 255], b = d.m_ColorMax || [255, 255, 255], out = field(d.m_nFieldOutput, F.Color);
    return (p) => { const t = rnd(); p.setV(out, new THREE.Vector3(lerp(a[0], b[0], t) / 255, lerp(a[1], b[1], t) / 255, lerp(a[2], b[2], t) / 255)); };
  },
  C_INIT_CreateWithinSphere: (d) => sphere(d, transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0)),
  C_INIT_CreateWithinSphereTransform: (d) => sphere(d, transform(d.m_TransformInput, 0)),
  C_INIT_InitialVelocityNoise(d) {
    if (d.m_bDisableOperator) return null;
    const mn = vector(d.m_vecOutputMin, [0, 0, 0]), mx = vector(d.m_vecOutputMax, [1, 1, 1]), ns = number(d.m_flNoiseScale, 0.1), nl = number(d.m_flNoiseScaleLoc, 0.01);
    const off = number(d.m_flOffset, 0), local = d.m_bLocalSpace, tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0);
    return (p, s) => {
      const k = nl(p, s), t = (p.created + off(p, s)) * ns(p, s), q = p.pos.clone().multiplyScalar(k).addScalar(t);
      const n = [noiseV(q), noiseV(q.clone().add(new THREE.Vector3(100000.5, 300000.25, 9000001))), noiseV(q.clone().add(new THREE.Vector3(110000.25, 310000.75, 9100000)))];
      const lo = mn(p, s), hi = mx(p, s), v = new THREE.Vector3(...[0, 1, 2].map((i) => n[i] * (hi.getComponent(i) - lo.getComponent(i)) * 0.5 + lo.getComponent(i) + (hi.getComponent(i) - lo.getComponent(i)) * 0.5));
      if (local) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(tr(s)));
      p.vel.add(v);
    };
  },
  C_INIT_RandomSequence(d) { const a = d.m_nSequenceMin ?? 0, b = d.m_nSequenceMax ?? 0; return (p) => { p.seq = b > a ? Math.min(a + Math.floor(rnd() * (b - a + 1)), b) : a; }; },
  C_INIT_RandomYawFlip(d) { const pc = d.m_flPercent ?? 0.5; return (p) => { if (rnd() < pc) p.rot.x += Math.PI; }; },
  C_INIT_RingWave(d) {
    const r0 = number(d.m_flInitialRadius), th = number(d.m_flThickness), ppo = number(d.m_flParticlesPerOrbit, -1), s0 = number(d.m_flInitialSpeedMin), s1 = number(d.m_flInitialSpeedMax);
    const even = d.m_bEvenDistribution, tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0), roll = number(d.m_flRoll), pitch = number(d.m_flPitch), yaw = number(d.m_flYaw), rad = Math.PI / 180; let orbit = 0;
    // The ring lies flat in the world (around the control point, not turned with it) unless it is
    // given a transform; its push outward is horizontal unless m_bXYVelocityOnly is off.
    const oriented = !!d.m_TransformInput, flat = d.m_bXYVelocityOnly !== false;
    return (p, s) => {
      const per = Math.max(1, ppo(p, s) === -1 ? s.max : ppo(p, s)); const a = even ? ((orbit = (orbit + 1) % per) / per) * Math.PI * 2 : rnd() * Math.PI * 2;
      const local = new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(r0(p, s)).add(inUnitBall().v.multiplyScalar(th(p, s)));
      local.applyEuler(new THREE.Euler(roll(p, s) * rad, pitch(p, s) * rad, yaw(p, s) * rad)); const m = tr(s), c = new THREE.Vector3().setFromMatrixPosition(m);
      p.pos.copy(oriented ? local.applyMatrix4(m) : local.add(c));
      const out = p.pos.clone().sub(c); if (flat) out.z = 0; out.normalize(); p.vel.add(out.multiplyScalar(lerp(s0(p, s), s1(p, s), rnd())));
    };
  },
  C_INIT_PositionWarp(d) {
    const a = vector(d.m_vecWarpMin, [1, 1, 1]), b = vector(d.m_vecWarpMax, [1, 1, 1]), cp = d.m_nControlPointNumber ?? 0, scp = d.m_nScaleControlPointNumber ?? -1;
    const time = d.m_flWarpTime ?? 0, start = d.m_flWarpStartTime ?? 0, invert = d.m_bInvertWarp;
    return (p, s) => { let lo = a(p, s).clone(), hi = b(p, s).clone(); if (invert) [lo, hi] = [hi, lo]; if (scp >= 0) { lo.multiply(s.cp(scp).pos); hi.multiply(s.cp(scp).pos); }
      const w = time === 0 ? new THREE.Vector3(lerp(lo.x, hi.x, rnd()), lerp(lo.y, hi.y, rnd()), lerp(lo.z, hi.z, rnd())) : lo.lerp(hi, saturate((p.created - start) / time));
      const m = s.cp(cp).matrix(), inv = m.clone().invert(); p.pos.applyMatrix4(inv).multiply(w).applyMatrix4(m); };
  },
  C_INIT_NormalAlignToCP(d) { const tr = transform(d.m_transformInput, d.m_nControlPointNumber ?? 0); return (p, s) => p.normal.set(1, 0, 0).transformDirection(tr(s)); },
  C_INIT_RemapParticleCountToScalar(d) {
    const i0 = d.m_nInputMin ?? 0, i1 = d.m_nInputMax ?? 1, o0 = d.m_flOutputMin ?? 0, o1 = d.m_flOutputMax ?? 1, out = field(d.m_nFieldOutput, F.Radius), active = d.m_bActiveRange, method = d.m_nSetMethod;
    return (p) => { if (active && (p.uid < i0 || p.uid > i1)) return; p.setS(out, setMethod(p, out, remapClamped(p.uid, i0, i1, o0, o1), method)); };
  },
  C_INIT_DistanceToCPInit(d) {
    const i0 = number(d.m_flInputMin), i1 = number(d.m_flInputMax, 128), o0 = number(d.m_flOutputMin), o1 = number(d.m_flOutputMax, 1), cp = d.m_nStartCP ?? 0, out = field(d.m_nFieldOutput, F.Radius), method = d.m_nSetMethod, active = d.m_bActiveRange;
    return (p, s) => { const dist = s.cp(cp).pos.distanceTo(p.pos), a = i0(p, s), b = i1(p, s); if (active && (dist < a || dist > b)) return; p.setS(out, setMethod(p, out, remapClamped(dist, a, b, o0(p, s), o1(p, s)), method)); };
  },
  C_INIT_CreateFromParentParticles(d) {
    const random = d.m_bRandomDistribution, scale = d.m_flVelocityScale ?? 0;
    return (p, s) => { const parent = s.parent?.sim?.particles; if (!parent?.length) return; const q = parent[random ? Math.floor(rnd() * parent.length) : p.uid % parent.length]; p.pos.copy(q.pos); p.vel.copy(q.vel).multiplyScalar(scale); };
  },
  // Snapshots: points on the model with their bones (.vsnap), skinned by the hero's skeleton.
  C_INIT_InitSkinnedPositionFromCPSnapshot(d) {
    const cp = d.m_nSnapshotControlPointNumber ?? 0, random = d.m_bRandom === true;
    return (p, s) => { const snap = s.snapshot(cp); if (!snap || !snap.count) { p.dead = true; s.sim.lib.unsupported.add('C_INIT_InitSkinnedPositionFromCPSnapshot: position snapshot unavailable'); return; } const i = random ? Math.floor(rnd() * snap.count) : p.uid % snap.count; p.snap = i; p.snapFrom = snap; p.pos.copy(snap.point(i)); p.prev.copy(p.pos); };
  },
  // Skinned snapshots follow the hero's bones; rigid ones (no bone weights, e.g. the Desolation
  // blades) hold points in the space of the snapshot's control point, which here is the arm.
  // A snapshot's other attributes (its points' colours, radii, normals) go to the particle born on
  // that point: Bane's Origin of the Unmaking's tentacles are dark blue in theirs, not white.
  C_INIT_InitFromCPSnapshot(d) {
    const cp = d.m_nControlPointNumber ?? 0, random = d.m_bRandom, attr = field(d.m_nAttributeToRead, F.Position), out = field(d.m_nAttributeToWrite, attr);
    const key = { [F.Color]: 'color', [F.Radius]: 'radius', [F.Normal]: 'normal', [F.Alpha]: 'alpha' }[attr];
    return (p, s) => { const snap = s.snapshot(cp); if (!snap) return;
      if (attr !== F.Position) { const values = key && snap.data[key]; if (!values?.length) return; const v = values[p.snap >= 0 ? p.snap % values.length : p.uid % values.length];
        if (Array.isArray(v)) p.setV(out, new THREE.Vector3(...v)); else p.setS(out, v); return; } const i = random ? Math.floor(rnd() * snap.count) : p.uid % snap.count; p.snap = i; p.snapFrom = snap;
      p.pos.copy(snap.point(i, s.cp(cp).matrix())); p.prev.copy(p.pos); if (snap.data.bone && s.model) p.bone = s.model.bone(snap.boneName()); };
  },
  C_INIT_CreateOnModel(d) {
    return (p, s) => { const m = s.model; if (!m) return;
      // On the model of what the effect is for (an item): a point of its surface, kept as it moves.
      const at = m.surface?.(); if (at) { p.surface = at; p.pos.copy(at()); p.prev.copy(p.pos); return; }
      const bone = m.bones[Math.floor(rnd() * m.bones.length)]; if (!bone) return; p.bone = bone; p.pos.copy(m.bonePosition(bone)).add(inUnitBall().v.multiplyScalar(4)); };
  },
};
function sphere(d, tr) {
  const r0 = number(d.m_fRadiusMin), r1 = number(d.m_fRadiusMax), v0 = number(d.m_fSpeedMin), v1 = number(d.m_fSpeedMax), exp = d.m_fSpeedRandExp ?? 1;
  const l0 = vector(d.m_LocalCoordinateSystemSpeedMin), l1 = vector(d.m_LocalCoordinateSystemSpeedMax), absb = vec(d.m_vecDistanceBiasAbs), biasV = vector(d.m_vecDistanceBias, [1, 1, 1]), local = d.m_bLocalCoords;
  return (p, s) => {
    const m = tr(s), origin = new THREE.Vector3().setFromMatrixPosition(m), m3 = new THREE.Matrix3().setFromMatrix4(m);
    const { v: dir, fraction } = inUnitBall(); if (absb.x) dir.x = Math.abs(dir.x); if (absb.y) dir.y = Math.abs(dir.y); if (absb.z) dir.z = Math.abs(dir.z);
    dir.multiply(biasV(p, s)).normalize(); const a = r0(p, s), b = r1(p, s), dist = (b - a) * fraction + a;
    const offset = dir.clone().multiplyScalar(dist); p.pos.copy(local ? offset.applyMatrix3(m3).add(origin) : origin.clone().add(offset));
    const speed = withExponent(exp, v0(p, s), v1(p, s)), lo = l0(p, s), hi = l1(p, s);
    const ls = new THREE.Vector3(lerp(lo.x, hi.x, rnd()), lerp(lo.y, hi.y, rnd()), lerp(lo.z, hi.z, rnd())).applyMatrix3(m3);
    p.vel.copy((local ? dir.clone().applyMatrix3(m3) : dir).multiplyScalar(speed)).add(ls);
  };
}
// The ground under the hero is the plane of his origin (z 0 of the effects' space).
const GROUND = 0;
// A control point's orientation, offset by angles in degrees (x pitch, y yaw, z roll: Source's QAngle).
const angles = (a) => new THREE.Quaternion().setFromEuler(new THREE.Euler(a.z * Math.PI / 180, a.x * Math.PI / 180, a.y * Math.PI / 180, 'ZYX'));
const qangle = (pitch, yaw, roll) => new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX'));
// A point along a path between two control points, bulged sideways (CPathParameters).
function pathPoint(params, t, s) {
  const a = s.cp(params?.m_nStartControlPointNumber ?? 0).pos, b = s.cp(params?.m_nEndControlPointNumber ?? 0).pos, mid = params?.m_flMidPoint ?? 0.5, bulge = params?.m_flBulge ?? 0;
  const p = a.clone().lerp(b, t); if (bulge) { const dir = b.clone().sub(a), side = dir.clone().cross(new THREE.Vector3(0, 0, 1)); if (side.lengthSq() < 1e-6) side.set(0, 1, 0); p.addScaledVector(side.normalize(), bulge * Math.sin(Math.PI * Math.min(1, t / Math.max(1e-3, mid * 2)))); }
  return p;
}
// ParticlePath (Source 2 Viewer): a quadratic curve from the start control point to the end one. Its
// middle is m_flMidPoint of the way, pushed along the forward of the start (m_nBulgeControl 1) or end
// (2) point by m_flBulge of the length (less as the path turns along it), or else by a random offset
// up to m_flBulge, one per system; a mid control point makes the curve pass through it.
function pathValues(pp, s, start = pp?.m_nStartControlPointNumber ?? 0, end = pp?.m_nEndControlPointNumber ?? 0) {
  const a = s.cp(start).pos.clone().add(vec(pp?.m_vStartPointOffset)), b = s.cp(end).pos.clone().add(vec(pp?.m_vEndOffset)), mc = pp?.m_nMidControlPointNumber ?? -1, off = vec(pp?.m_vMidPointOffset);
  if (mc > -1) return [a, s.cp(mc).pos.clone().multiplyScalar(2).addScaledVector(a.clone().add(b), -0.5).add(off), b];
  const m = a.clone().lerp(b, pp?.m_flMidPoint ?? 0.5), bulge = pp?.m_flBulge ?? 0, ctl = pp?.m_nBulgeControl ?? 0;
  if (ctl) { const f = forward(s.cp(ctl === 2 ? end : start)), dir = b.clone().sub(a), len = dir.length(); m.addScaledVector(f, len > 1e-6 ? len * bulge * (1 - Math.abs(dir.dot(f) / len)) : 0); }
  else m.add(new THREE.Vector3(lerp(-bulge, bulge, hash(s.seed, 201)), lerp(-bulge, bulge, hash(s.seed, 202)), lerp(-bulge, bulge, hash(s.seed, 203))));
  return [a, m.add(off), b];
}
const pathAt = ([a, m, b], t) => a.clone().lerp(m, t).lerp(m.clone().lerp(b, t), t);
const clampCP = (i) => Math.min(63, Math.max(0, i));
const forward = (c) => new THREE.Vector3(1, 0, 0).applyQuaternion(c.quat);
const translation = (m) => new THREE.Vector3().setFromMatrixPosition(m);
const jitter = (r) => new THREE.Vector3(lerp(-r, r, rnd()), lerp(-r, r, rnd()), lerp(-r, r, rnd()));
const color24 = (c) => (c ? new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255) : new THREE.Vector3(1, 1, 1));
const EPSILON = 1.1920929e-7;
// ParticleMath.Bias, clamped at its ends.
const pbias = (x, b) => (b <= 0 ? 0 : b >= 1 ? 1 : bias(x, b));
// EntityTransformHelper: a rotation's (pitch, yaw, roll), and a direction's, in radians.
function eulerAngles(q) {
  const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fy = 2 * (q.x * q.y + q.w * q.z), fz = 2 * (q.x * q.z - q.w * q.y), xy = Math.hypot(fx, fy);
  if (xy > 0.001) return new THREE.Vector3(Math.atan2(-fz, xy), Math.atan2(fy, fx), Math.atan2(2 * (q.y * q.z + q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)));
  return new THREE.Vector3(Math.atan2(-fz, xy), Math.atan2(-2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z)), 0);
}
const forwardAngles = (f) => { const xy = Math.hypot(f.x, f.y); return xy <= 0.001 ? new THREE.Vector3(f.z > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0) : new THREE.Vector3(Math.atan2(-f.z, xy), Math.atan2(f.y, f.x), 0); };
// Whether a control point was given: in the game one never set reads zero (here it would read cp 0).
const known = (s, i) => { for (let t = s; t; t = t.parent) if (t.own.has(i)) return true; return s.sim.root.cps.has(i); };
const cpValue = (s, i) => (known(s, i) ? s.cp(i).pos.clone() : new THREE.Vector3());
// Sets a control point's position, keeping its orientation (SetControlPointValue).
const setCPValue = (s, i, v) => s.override(i, v, s.cp(i).quat);
// How long each sequence of the first sheet the system's renderers draw with runs, in frames.
function sheetDurations(sim) {
  for (const r of sim.def.m_Renderers || []) { if (r.m_bDisableOperator) continue; const seqs = sim.lib.textures?.[r.m_vecTexturesInput?.[0]?.m_hTexture || r.m_hTexture]?.sequences;
    if (seqs?.length) return seqs.map((q) => q.frames.reduce((a, f) => a + f.time, 0)); }
  return null;
}
Object.assign(INIT, {
  // One particle after another along the path (or each pair of control points from start to end),
  // m_flNumToAssign to a pass, back and forth without m_bLoop; m_bSaveOffset keeps where (t, start, end).
  C_INIT_CreateSequentialPath(d) {
    const pp = d.m_PathParams, a = pp?.m_nStartControlPointNumber ?? 0, b = pp?.m_nEndControlPointNumber ?? 0, n = d.m_flNumToAssign ?? 100, loop = d.m_bLoop !== false, pairs = d.m_bCPPairs, save = d.m_bSaveOffset, dist = d.m_fMaxDistance ?? 0;
    const step0 = n <= 1 ? 0 : 1 / (n - 1), spread = pairs && b - a > 1 && n > 1;
    let t = 0, wrap = -1, cp = pairs ? a : 0, step = spread ? (b - a) * step0 : step0, cpStep = spread ? (b - a) * step0 : 0;
    return (p, s) => {
      let i0 = a, i1 = b;
      if (pairs) {
        if (Math.trunc(cp) > b || Math.trunc(cp) < a) { if (loop) cp = a; else { cpStep = -cpStep; step = -step; wrap = -wrap; cp += 2 * cpStep; t += 2 * step; } }
        i0 = Math.trunc(cp); i1 = i0 === b ? i0 : i0 + 1;
      }
      if (t > 1.0000001 || t < 0) { if (loop || pairs) t += wrap; else { step = -step; wrap = -wrap; t += 2 * step; } }
      p.pos.copy(pathAt(pathValues(pp, s, i0, i1), t)).add(jitter(dist)); p.prev.copy(p.pos); p.pathT = t; if (save) p.hbo.set(t, i0, i1);
      t += step; cp += cpStep;
    };
  },
  // The same, with a count that may change, and the pairs' parameter running over all of them.
  C_INIT_CreateSequentialPathV2(d) {
    const pp = d.m_PathParams, a = pp?.m_nStartControlPointNumber ?? 0, b = pp?.m_nEndControlPointNumber ?? 0, dist = number(d.m_fMaxDistance), count = number(d.m_flNumToAssign, 100), loop = d.m_bLoop !== false, save = d.m_bSaveOffset;
    const dir = b >= a ? 1 : -1, span = d.m_bCPPairs ? Math.abs(b - a) : 1, pairs = d.m_bCPPairs && span > 1; let t = 0, step = 0, cached = NaN;
    return (p, s) => {
      const n = count(null, s); if (n !== cached) { cached = n; step = n > 1 ? 1 / (n - 1) : 0; if (pairs) step *= span; }
      const pa = s.cp(a).pos, pb = s.cp(b).pos, distinct = !(pairs && loop) || Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y), Math.abs(pa.z - pb.z)) > 0.001;
      let u = t, i0 = a, i1 = b;
      if (pairs) { i0 = a + Math.trunc(u) * dir; i1 = i0 + dir; u -= Math.trunc(u); if (dir * (dir + i0 - b) >= 1) { i1 = b; i0 = b - dir; u = 1; } }
      p.pos.copy(pathAt(pathValues(pp, s, i0, i1), u)); if (save) p.hbo.set(u, i0, i1); p.pos.add(jitter(dist(p, s))); p.prev.copy(p.pos);
      const last = t; t += step;
      if (step > 0) { if (Math.abs(t - span) < 1e-5) t = span; else if (Math.abs(t) < 1e-5) t = 0; }
      if (t > span || t < 0) { let w = step <= 0 ? -t : t - span; if (loop) t = distinct && last === span ? 0 : w; else { if (step >= 0) w = span - w; t = w; step = -step; } }
    };
  },
  // A random point along the path (between a random pair of consecutive control points with m_bUseRandomCPs).
  C_INIT_CreateAlongPath(d) {
    const pp = d.m_PathParams, a = pp?.m_nStartControlPointNumber ?? 0, b = pp?.m_nEndControlPointNumber ?? 0, random = d.m_bUseRandomCPs, save = d.m_bSaveOffset, dist = number(d.m_fMaxDistance ?? d.m_flMaxDistance);
    // Content without m_fT, or with one of no type, draws t uniformly every particle.
    const T = d.m_fT === undefined ? null : typeof d.m_fT === 'object' && !d.m_fT.m_nType ? number({ m_flRandomMin: 0, m_flRandomMax: 1, m_nRandomMode: 'PF_RANDOM_MODE_VARYING', ...d.m_fT, m_nType: 'PF_TYPE_RANDOM_UNIFORM' }) : number(d.m_fT, 0);
    return (p, s) => {
      let i0 = a, i1 = b; if (random) { i1 = a + 1 + Math.trunc(rnd() * (b - a)); i0 = i1 - 1; }
      const v = pathValues(pp, s, i0, i1), t = T ? T(p, s) : rnd(); p.pos.copy(pathAt(v, t)).add(jitter(dist(p, s))); if (save) p.hbo.set(t, i0, i1);
    };
  },
  C_INIT_SequenceLifeTime(d) {
    const rate = d.m_flFramerate ?? 30; let durations;
    return (p, s) => { if (durations === undefined) durations = sheetDurations(s.sim); if (!rate || !durations) return; const t = durations[p.seq] ?? 0; p.life = t > 0 ? t / rate : 1; };
  },
  C_INIT_RemapScalarToVector(d) {
    const fin = field(d.m_nFieldInput, F.CreationTime), out = field(d.m_nFieldOutput, F.Position), i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, o0 = vec(d.m_vecOutputMin), o1 = vec(d.m_vecOutputMax, [1, 1, 1]);
    const st = d.m_flStartTime ?? -1, et = d.m_flEndTime ?? -1, method = d.m_nSetMethod, cp = d.m_nControlPointNumber ?? 0, local = d.m_bLocalCoords !== false, b = d.m_flRemapBias ?? 0.5;
    return (p, s) => {
      if (!VECTOR.has(out) || (st >= 0 && et >= 0 && (p.created < st || p.created > et))) return;
      let x = saturate(remap(p.getS(fin), i0, i1)); if (b !== 0.5 && b > 0) x = Math.pow(x, Math.log(b) / Math.log(0.5));
      // In local coordinates positions are offsets from the control point, directions turn with it.
      const v = o0.clone().lerp(o1, x);
      if (local && (out === F.Position || out === F.PositionPrevious || out === F.HitboxOffsetPosition)) v.applyMatrix4(s.cp(cp).matrix());
      else if (local && (out === F.Normal || out === F.ScratchVector || out === F.ScratchVector2)) v.applyQuaternion(s.cp(cp).quat);
      p.setV(out, setVMethod(p, out, v, method, s.sim.dt, true));
    };
  },
  // The particle starts part way through its life, by noise of where and when it is created.
  C_INIT_AgeNoise(d) {
    const abs = d.m_bAbsVal, inv = d.m_bAbsValInv, off = d.m_flOffset ?? 0, a0 = d.m_flAgeMin ?? 0, a1 = d.m_flAgeMax ?? 1, ns = d.m_flNoiseScale ?? 1, nl = d.m_flNoiseScaleLoc ?? 1, loc = vec(d.m_vecOffsetLoc);
    return (p) => {
      const q = p.pos.clone().add(loc).multiplyScalar(nl).addScalar((p.created + off) * ns), n = value3(q.x, q.y, q.z), k = abs ? 1 : 0.5;
      let x = abs ? Math.abs(n) : n; if (inv) x = 1 - x; const age = saturate(a0 + (1 - k) * (a1 - a0) + k * (a1 - a0) * x) * p.life; p.age += age; p.created -= age;
    };
  },
  C_INIT_VelocityFromCP(d) {
    // Older content names the control point (and one to take it relative to) instead of a vector input.
    const legacy = !d.m_velocityInput && d.m_nControlPoint !== undefined, cp = d.m_nControlPoint ?? 0, cmp = d.m_nControlPointCompare ?? -1, lcp = d.m_nControlPointLocal ?? -1;
    const input = legacy ? (p, s) => (cmp >= 0 && cmp <= 63 ? s.cp(cp).pos.clone().sub(s.cp(cmp).pos) : s.cp(cp).pos.clone()) : vector(d.m_velocityInput ?? { m_nType: 'PVEC_TYPE_CP_VALUE', m_nControlPoint: 0 });
    const ti = d.m_transformInput, tr = ti && ti.m_nType !== 'PT_TYPE_INVALID' ? transform(ti) : legacy && lcp >= 0 ? transform(null, lcp) : null, scale = d.m_flVelocityScale ?? 1, dirOnly = d.m_bDirectionOnly;
    return (p, s) => { const v = input(p, s).clone(); if (dirOnly) v.normalize(); v.multiplyScalar(scale); if (tr) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(tr(s))); p.vel.add(v); };
  },
  // Outward from a control point at a random speed (m_bIgnoreDelta: a distance a step rather than a second).
  C_INIT_VelocityRadialRandom(d) {
    const scale = vector(d.m_vecLocalCoordinateSystemSpeedScale, [1, 1, 1]), v0 = number(d.m_fSpeedMin), v1 = number(d.m_fSpeedMax), cp = d.m_nControlPointNumber ?? 0, perStep = d.m_bIgnoreDelta;
    return (p, s) => { let speed = lerp(v0(p, s), v1(p, s), rnd()); if (perStep && s.sim.dt > 0) speed /= s.sim.dt; p.vel.add(p.pos.clone().sub(s.cp(cp).pos).normalize().multiplyScalar(speed).multiply(scale(p, s))); };
  },
  // Scales radius, position (about a control point) and velocity, by m_flScale times a control point's x.
  C_INIT_GlobalScale(d) {
    const k = d.m_flScale ?? 1, scp = d.m_nScaleControlPointNumber ?? -1, cp = d.m_nControlPointNumber ?? 0, radius = d.m_bScaleRadius !== false, position = d.m_bScalePosition !== false, velocity = d.m_bScaleVelocity !== false;
    return (p, s) => {
      let f = k; if (scp >= 0) { const x = cpValue(s, scp).x; if (x === 0) return; f *= x; } if (f === 1) return;
      if (radius) p.radius *= f; if (position) { const o = s.cp(cp).pos; p.pos.sub(o).multiplyScalar(f).add(o); } if (velocity) p.vel.multiplyScalar(f);
    };
  },
  // At the control points from m_nMinCP to m_nMaxCP (every m_nIncrement), one particle after another.
  C_INIT_CreateFromCPs(d) {
    const inc = d.m_nIncrement ?? 1, lo = d.m_nMinCP ?? 0, dyn = number(d.m_nDynamicCPCount, -1);
    return (p, s) => {
      const hi = s.sim.version < 2 ? 63 : d.m_nMaxCP ?? 0, k = Math.trunc(dyn(p, s)), range = Math.trunc((hi - lo) / inc) + 1;
      const n = Math.max(1, k > 0 ? k : inc <= 0 || hi < lo ? 1 : range), i = p.uid % n; let cp = lo + i * Math.max(1, inc);
      if (cp > hi) cp = inc > 0 && hi >= lo ? lo + (i % range) * inc : lo;
      p.pos.copy(s.cp(cp).pos); p.vel.set(0, 0, 0);
    };
  },
  C_INIT_InitFloatCollection(d) { const out = field(d.m_nOutputField, F.Radius), value = number(d.m_InputValue); return (p, s) => p.setS(out, value(null, s)); },
  // A control point's position remapped per component (the outputs turned by m_LocalSpaceTransform).
  C_INIT_RemapTransformToVector(d) {
    const out = field(d.m_nFieldOutput, F.Position), i0 = vec(d.m_vInputMin), i1 = vec(d.m_vInputMax), o0 = vec(d.m_vOutputMin), o1 = vec(d.m_vOutputMax), tr = transform(d.m_TransformInput, 0);
    const lst = (d.m_LocalSpaceTransform?.m_nType ?? 'PT_TYPE_INVALID') !== 'PT_TYPE_INVALID' ? transform(d.m_LocalSpaceTransform, 0) : null;
    const st = d.m_flStartTime ?? -1, et = d.m_flEndTime ?? -1, method = d.m_nSetMethod, offset = d.m_bOffset, accel = d.m_bAccelerate, b = d.m_flRemapBias ?? 0.5;
    const unit = new Set([F.Color, F.Alpha, F.AlphaAlternate, F.GlowRgb, F.GlowAlpha]);
    return (p, s) => {
      if (st !== -1 && et !== -1 && (p.created < st || p.created >= et)) return;
      const x = translation(tr(s)), lo = o0.clone(), hi = o1.clone(); if (lst) { const q = new THREE.Quaternion().setFromRotationMatrix(lst(s)); lo.applyQuaternion(q); hi.applyQuaternion(q); }
      let v = new THREE.Vector3(...[0, 1, 2].map((k) => remapClamped(x.getComponent(k), i0.getComponent(k), i1.getComponent(k), lo.getComponent(k), hi.getComponent(k))));
      if (b !== 0.5) v.set(pbias(saturate(v.x), b), pbias(saturate(v.y), b), pbias(saturate(v.z), b));
      v = setVMethod(p, out, v, method, s.sim.dt, true); const dt = s.sim.dt;
      if (unit.has(out)) p.setV(out, v.clampScalar(0, 1));
      else if (accel && !offset) p.setV(out, v.multiplyScalar(dt));
      else if (offset) { v.add(p.getV(out)); p.prev.add(v); p.setV(out, accel ? v.multiplyScalar(1 + dt) : v); }
      else p.setV(out, v);
    };
  },
  C_INIT_RandomVectorComponent(d) {
    const out = field(d.m_nFieldOutput, F.Position), a = d.m_flMin ?? 0, b = d.m_flMax ?? 0, c = Math.min(2, Math.max(0, d.m_nComponent ?? 0));
    return (p) => { const v = p.getV(out).clone(); if (c >= 0 && c <= 2) v.setComponent(c, lerp(a, b, rnd())); p.setV(out, v); };
  },
  // The particle's offset from a control point, turned m_flOffsetRot degrees about m_vecOffsetAxis.
  C_INIT_RemapInitialDirectionToTransformToVector(d) {
    const tr = transform(d.m_TransformInput, 0), out = field(d.m_nFieldOutput, F.Position), scale = d.m_flScale ?? 1, normalize = d.m_bNormalize, x = vec(d.m_vecOffsetAxis);
    const r = (d.m_flOffsetRot ?? 0) * Math.PI / 180, sn = Math.sin(r), cs = Math.cos(r), rv = 1 - cs;
    const rows = [new THREE.Vector3((1 - x.x * x.x) * cs + x.x * x.x, x.x * x.y * rv - x.z * sn, x.x * x.z * rv + x.y * sn),
      new THREE.Vector3(x.y * x.x * rv + x.z * sn, (1 - x.y * x.y) * cs + x.y * x.y, x.y * x.z * rv - x.x * sn),
      new THREE.Vector3(x.x * x.z * rv - x.y * sn, x.y * x.z * rv + x.x * sn, (1 - x.z * x.z) * cs + x.z * x.z)];
    return (p, s) => { const delta = p.pos.clone().sub(translation(tr(s))), v = new THREE.Vector3(delta.dot(rows[0]), delta.dot(rows[1]), delta.dot(rows[2]));
      // A tiny z first: no offset at all points along the third axis.
      if (normalize) { v.z += EPSILON; v.normalize(); } p.setV(out, v.multiplyScalar(scale)); };
  },
  // A control point's yaw (from behaviour version 7 the angle m_nComponent of its rotation, negated).
  C_INIT_RemapInitialTransformDirectionToRotation(d) {
    const tr = transform(d.m_TransformInput, 0), out = field(d.m_nFieldOutput, F.Yaw), off = (d.m_flOffsetRot ?? 0) * Math.PI / 180, comp = Math.min(2, Math.max(0, d.m_nComponent ?? 1));
    return (p, s) => { const q = new THREE.Quaternion().setFromRotationMatrix(tr(s)), f = new THREE.Vector3(1, 0, 0).applyQuaternion(q), v = s.sim.version;
      p.setS(out, v >= 7 ? off - (comp >= 0 && comp <= 2 ? eulerAngles(q).getComponent(comp) : 0) : off + Math.atan2(f.y, f.x) + (v < 4 ? Math.PI : 0)); };
  },
  C_INIT_RemapTransformOrientationToRotations(d) { const op = OP.C_OP_RemapTransformOrientationToRotations(d); return (p, s) => op([p], 0, s, 1); },
  C_INIT_RandomSecondSequence(d) { const a = d.m_nSequenceMin ?? 0, b = d.m_nSequenceMax ?? 0; return (p) => { p.seq2 = a + Math.floor(rnd() * (b - a + 1)); }; },
  C_INIT_RemapCPtoVector(d) { const op = OP.C_OP_RemapCPtoVector(d), k = strength(d); return (p, s) => op([p], 0, s, k(s)); },
  C_INIT_CreateWithinBox(d) {
    const a = vector(d.m_vecMin), b = vector(d.m_vecMax), cp = d.m_nControlPointNumber ?? 0, local = d.m_bLocalSpace;
    return (p, s) => { const lo = a(p, s), hi = b(p, s), o = new THREE.Vector3(lerp(lo.x, hi.x, rnd()), lerp(lo.y, hi.y, rnd()), lerp(lo.z, hi.z, rnd())); if (local) o.applyQuaternion(s.cp(cp).quat); p.pos.copy(s.cp(cp).pos).add(o); p.prev.copy(p.pos); };
  },
  C_INIT_InheritVelocity: () => () => {},
  // Children made where a parent particle was (where one died, in the game: here any of them).
  C_INIT_InitFromParentKilled(d) { return INIT.C_INIT_CreateFromParentParticles({ m_bRandomDistribution: true }); },
  // An epitrochoid in two of the control point's axes: radius 1 rolling round radius 2, the point at
  // the offset from its centre, along the curve by particle number × density (or at random).
  C_INIT_CreateInEpitrochoid(d) {
    const c1 = d.m_nComponent1 ?? 0, c2 = d.m_nComponent2 ?? 1, tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0), density = number(d.m_flParticleDensity, 0.1), off = number(d.m_flOffset, 4), r1 = number(d.m_flRadius1, 40), r2 = number(d.m_flRadius2, 24);
    const byCount = d.m_bUseCount, local = d.m_bUseLocalCoords, onExisting = d.m_bOffsetExistingPos;
    return (p, s) => {
      const R = r1(p, s), r = r2(p, s) || 1, o = off(p, s), u = byCount ? p.uid * density(p, s) : rnd() * Math.PI * 2 * Math.max(1, Math.abs(r));
      const v = new THREE.Vector3(); if (c1 >= 0 && c1 <= 2) v.setComponent(c1, (R + r) * Math.cos(u) - o * Math.cos(((R + r) / r) * u)); if (c2 >= 0 && c2 <= 2) v.setComponent(c2, (R + r) * Math.sin(u) - o * Math.sin(((R + r) / r) * u));
      const m = tr(s); if (local) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(m));
      if (onExisting) p.pos.add(v); else p.pos.setFromMatrixPosition(m).add(v); p.prev.copy(p.pos);
    };
  },
  // Points spread evenly over a sphere (a golden-angle spiral), pushed outward.
  C_INIT_CreateSpiralSphere(d) {
    const cp = d.m_nControlPointNumber ?? 0, n = Math.max(1, d.m_nDensity ?? 1), r = d.m_flInitialRadius ?? 1, v0 = d.m_flInitialSpeedMin ?? 0, v1 = d.m_flInitialSpeedMax ?? 0;
    return (p, s) => { const i = p.uid % n, z = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(Math.max(0, 1 - z * z)), a = Math.PI * (1 + Math.sqrt(5)) * i, dir = new THREE.Vector3(rr * Math.cos(a), rr * Math.sin(a), z);
      p.pos.copy(s.cp(cp).pos).addScaledVector(dir, r); p.prev.copy(p.pos); p.vel.addScaledVector(dir, lerp(v0, v1, rnd())); };
  },
  // On the model, at a height above the control point.
  C_INIT_CreateOnModelAtHeight(d) {
    const cp = d.m_nControlPointNumber ?? 0, h = number(d.m_flDesiredHeight, 0);
    return (p, s) => { const m = s.model; if (!m?.bones.length) return; const bone = m.bones[Math.floor(rnd() * m.bones.length)]; p.pos.copy(m.bonePosition(bone)); p.pos.z = s.cp(cp).pos.z + h(p, s); p.prev.copy(p.pos); };
  },
  // Rigid attachment to a control point: C_OP_MovementRigidAttachToCP carries the particles along.
  C_INIT_SetRigidAttachment: () => () => {},
  // The radius of the object at a control point: the hero's model scale, 1 here (Terrorblade's blade
  // planes, drawn as models, are their own size; the default radius of 5 made them 30 m long).
  C_INIT_RadiusFromCPObject: () => (p) => { p.radius = 1; },
  C_INIT_PositionPlaceOnGround(d) { const off = number(d.m_flOffset); return (p, s) => { p.pos.z = GROUND + off(p, s); p.prev.z = p.pos.z; }; },
  C_INIT_CreationNoise(d) {
    const out = field(d.m_nFieldOutput, F.Radius), lo = d.m_flOutputMin ?? 0, hi = d.m_flOutputMax ?? 1, ns = d.m_flNoiseScale ?? 0.1, nl = d.m_flNoiseScaleLoc ?? 0.001, abs = d.m_bAbsVal, inv = d.m_bAbsValInv, off = d.m_flOffset ?? 0;
    return (p) => { let n = noise3(p.pos.x * nl + (p.created + off) * ns, p.pos.y * nl, p.pos.z * nl); if (abs || inv) { n = Math.abs(n); if (inv) n = 1 - n; } else n = (n + 1) / 2;
      let v = lerp(lo, hi, saturate(n)); if (ANGLE.has(out)) v *= Math.PI / 180; p.setS(out, v); };
  },
  C_INIT_VelocityRandom(d) {
    const v0 = number(d.m_fSpeedMin), v1 = number(d.m_fSpeedMax), l0 = vector(d.m_LocalCoordinateSystemSpeedMin), l1 = vector(d.m_LocalCoordinateSystemSpeedMax), tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0);
    return (p, s) => { const m3 = new THREE.Matrix3().setFromMatrix4(tr(s)), lo = l0(p, s), hi = l1(p, s);
      const v = inUnitBall().v.multiplyScalar(lerp(v0(p, s), v1(p, s), rnd())).add(new THREE.Vector3(lerp(lo.x, hi.x, rnd()), lerp(lo.y, hi.y, rnd()), lerp(lo.z, hi.z, rnd())).applyMatrix3(m3));
      p.vel.add(v); p.prev.addScaledVector(v, -(s.prevDt || s.sim.maxStep)); };
  },
  C_INIT_RemapInitialCPDirectionToRotation(d) {
    const cp = d.m_nCP ?? 0, out = field(d.m_nFieldOutput, F.Roll), off = (d.m_flOffsetRot ?? 0) * Math.PI / 180, comp = d.m_nComponent ?? 0;
    return (p, s) => { const dir = new THREE.Vector3(...[[1, 0, 0], [0, 1, 0], [0, 0, 1]][comp]).applyQuaternion(s.cp(cp).quat); p.setS(out, Math.atan2(dir.y, dir.x) + off); };
  },
  C_INIT_NormalOffset(d) {
    const a = vec(d.m_OffsetMin), b = vec(d.m_OffsetMax), local = d.m_bLocalCoords, cp = d.m_nControlPointNumber ?? 0, normalize = d.m_bNormalize;
    return (p, s) => { const o = new THREE.Vector3(lerp(a.x, b.x, rnd()), lerp(a.y, b.y, rnd()), lerp(a.z, b.z, rnd())); if (local) o.applyQuaternion(s.cp(cp).quat); p.normal.add(o); if (normalize) p.normal.normalize(); };
  },
  C_INIT_RemapCPOrientationToRotations(d) { const op = OP.C_OP_RemapCPOrientationToRotations(d); return (p, s) => op([p], 0, s, 1); },
  C_INIT_InheritFromParentParticles(d) {
    const f = field(d.m_nFieldOutput, F.Color), scale = d.m_flScale ?? 1, random = d.m_bRandomDistribution, inc = d.m_nIncrement ?? 1;
    return (p, s) => { const parent = s.parent?.sim?.particles; if (!parent?.length) return; const q = parent[random ? Math.floor(rnd() * parent.length) : (p.uid * inc) % parent.length];
      if (f === F.Position || f === F.Color || f === F.Normal) p.setV(f, q.getV(f).clone().multiplyScalar(f === F.Position ? 1 : scale)); else p.setS(f, q.getS(f) * scale); };
  },
});
INIT.C_INIT_PositionOffset = (d) => {
  const a = vector(d.m_OffsetMin), b = vector(d.m_OffsetMax), local = d.m_bLocalCoords, proportional = d.m_bProportional, tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0);
  return (p, s) => { const lo = a(p, s), hi = b(p, s); const o = new THREE.Vector3(lerp(lo.x, hi.x, rnd()), lerp(lo.y, hi.y, rnd()), lerp(lo.z, hi.z, rnd()));
    if (proportional) o.multiplyScalar(p.radius); if (local) o.applyMatrix3(new THREE.Matrix3().setFromMatrix4(tr(s))); p.pos.add(o); };
};

function forwardBasis(forward) {
  const f = forward.clone().normalize(); let right;
  if (Math.abs(f.x) < 1e-6 && Math.abs(f.y) < 1e-6) right = new THREE.Vector3(0, -1, 0); else right = f.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
  const up = right.clone().cross(f), left = right.clone().negate();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, left, up));
}
const OP = {
  C_OP_Decay: () => (ps) => { for (const p of ps) if (p.age > p.life) p.dead = true; },
  // Those shrunk below a radius (1 by default) are gone.
  C_OP_RadiusDecay(d) { const min = d.m_flMinRadius ?? 1; return (ps) => { for (const p of ps) if (p.radius < min) p.dead = true; }; },
  C_OP_BasicMovement(d) {
    const g = vector(d.m_Gravity), drag = number(d.m_fDrag);
    return (ps, dt, s) => {
      // The force generators (m_ForceGenerators) run from here, adding to each particle's force first.
      for (const o of s.sim.forces) { if (!s.sim.runs(o)) continue; const k = o.strength(s); if (k > 0) o.fn(ps, dt, s, k); }
      const gm = g(null, s).clone().multiplyScalar(dt * dt), dv = saturate(Math.min(drag(null, s), 0.9999999));
      let df = Math.exp(Math.log(1 - dv) / (1 / 30) * dt); if (s.prevDt > 0) df *= dt / s.prevDt;
      for (const p of ps) { const step = gm.clone().add(p.force.clone().multiplyScalar(dt * dt)).multiplyScalar(p.forceScale).add(p.pos.clone().sub(p.prev).multiplyScalar(df));
        p.vel.copy(step).divideScalar(dt); p.force.set(0, 0, 0); p.prev.copy(p.pos); p.pos.add(step); }
    };
  },
  C_OP_FadeInSimple(d) { const t = d.m_flFadeInTime ?? 0.25, out = field(d.m_nFieldOutput, F.Alpha); return (ps) => { if (t <= 0) return; for (const p of ps) if (p.nage <= t) p.setS(out, (p.nage / t) * p.initS(F.Alpha)); }; },
  C_OP_FadeOutSimple(d) { const t = d.m_flFadeOutTime ?? 0.25, out = field(d.m_nFieldOutput, F.Alpha); return (ps) => { if (t <= 0) return; for (const p of ps) { const left = 1 - p.nage; if (left <= t) p.setS(out, (left / t) * p.initS(F.Alpha)); } }; },
  C_OP_FadeOut(d) {
    const t0 = d.m_flFadeOutTimeMin ?? 0.25, t1 = d.m_flFadeOutTimeMax ?? 0.25, prop = d.m_bProportional !== false, ease = d.m_bEaseInAndOut !== false;
    return (ps) => { for (const p of ps) { const t = lerp(t0, t1, hash(p.uid, 91)); const left = prop ? 1 - p.nage : p.life - p.age; if (t > 0 && left <= t) { let k = saturate(left / t); if (ease) k = k * k * (3 - 2 * k); p.alpha = k * p.initS(F.Alpha); } } };
  },
  C_OP_InterpolateRadius(d) {
    const st = d.m_flStartTime ?? 0, et = d.m_flEndTime ?? 1, ss = number(d.m_flStartScale, 1), es = number(d.m_flEndScale, 1), ease = d.m_bEaseInAndOut, b = d.m_flBias || 0.5;
    return (ps, dt, s) => { if (et <= st) return; for (const p of ps) { if (p.life <= 0) continue; const t = p.nage; if (t < st || t > et + dt / p.life) continue;
      let k = saturate(remap(t, st, et)); if (ease) k = k * k * (3 - 2 * k); else if (b !== 0.5) k = bias(k, b); const a = ss(p, s), c = es(p, s);
      p.radius = p.initS(F.Radius) * Math.min(Math.max(lerp(a, c, k), Math.min(a, c)), Math.max(a, c)); } };
  },
  C_OP_ColorInterpolate(d) {
    const c = d.m_ColorFade || [255, 255, 255], fadeTo = new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255), st = d.m_flFadeStartTime ?? 0, et = d.m_flFadeEndTime ?? 1, out = field(d.m_nFieldOutput, F.Color), ease = d.m_bEaseInOut !== false;
    return (ps, dt, s, str) => { for (const p of ps) { const t = p.nage; if (t < st || t > et) continue; let k = saturate(remap(t, st, et)); if (ease) k = k * k * (3 - 2 * k);
      const init = p.initV(F.Color).clone(); p.setV(out, init.clone().lerp(init.clone().lerp(fadeTo, k), str)); } };
  },
  C_OP_PositionLock(d) {
    const tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0), s0 = d.m_flStartTime_min ?? 1, s1 = d.m_flStartTime_max ?? 1, e0 = d.m_flEndTime_min ?? 1, e1 = d.m_flEndTime_max ?? 1, rotLock = d.m_bLockRot;
    let prev = null;
    return (ps, dt, s, str) => {
      const m = tr(s), pos = new THREE.Vector3().setFromMatrixPosition(m);
      if (!prev) prev = m.clone();
      const prevPos = new THREE.Vector3().setFromMatrixPosition(prev), delta = pos.clone().sub(prevPos), lock = rotLock ? m.clone().multiply(prev.clone().invert()) : null;
      prev = m.clone(); if (delta.lengthSq() === 0 && !rotLock) return;
      for (const p of ps) {
        let fadeK = 1; if (s0 < 1) { const a = lerp(s0, s1, hash(p.uid, 21)), b = lerp(e0, e1, hash(p.uid, 22)); fadeK = p.nage <= a ? 1 : 1 - saturate(remap(p.nage, a, b)); }
        const k = str * fadeK; if (k <= 0) continue; const cf = dt > 0 ? Math.min(p.age, dt) / dt : 1;
        if (rotLock) { const rp = p.pos.clone().applyMatrix4(lock), rq = p.prev.clone().applyMatrix4(lock); p.pos.lerp(rp, k * cf); p.prev.lerp(rq, k * cf); }
        else { const sd = delta.clone().multiplyScalar(cf * k); p.pos.add(sd); p.prev.add(sd); }
      }
    };
  },
  C_OP_VectorNoise(d) {
    const out = field(d.m_nFieldOutput, F.Color), lo = vec(d.m_vecOutputMin), hi = vec(d.m_vecOutputMax, [1, 1, 1]), scale = d.m_fl4NoiseScale ?? 0.1, tscale = d.m_flNoiseAnimationTimeScale ?? 0, add = d.m_bAdditive;
    const half = hi.clone().sub(lo).multiplyScalar(0.5), base = half.clone().add(lo);
    return (ps, dt, s, str) => { const to = tscale * s.age; for (const p of ps) { const c = p.pos.clone().multiplyScalar(scale); c.x += to;
      const c2 = c.clone().add(new THREE.Vector3(100000.5, 300000.25, 9000001)), c3 = c2.clone().add(new THREE.Vector3(110000.25, 310000.75, 9100000));
      const v = new THREE.Vector3(noiseV(c), noiseV(c2), noiseV(c3)).multiply(half).add(base);
      if (!add) { p.setV(out, v); continue; } v.multiplyScalar(dt * str); p.getV(out).add(v); if (out === F.Position) p.prev.add(v); } };
  },
  C_OP_RampScalarLinear(d) {
    const r0 = d.m_RateMin ?? 0, r1 = d.m_RateMax ?? 0, s0 = d.m_flStartTime_min ?? 0, s1 = d.m_flStartTime_max ?? 0, e0 = d.m_flEndTime_min ?? 1, e1 = d.m_flEndTime_max ?? 1, f = field(d.m_nField, F.Radius);
    return (ps, dt, s, str) => { for (const p of ps) { const a = lerp(s0, s1, hash(p.uid, 11)), b = lerp(e0, e1, hash(p.uid, 12)); if (p.nage < a || p.nage >= b) continue;
      let v = p.getS(f) + lerp(r0, r1, hash(p.uid, 13)) * dt * str; if (f === F.Alpha) v = saturate(v); if (f === F.Radius) v = Math.max(0, v); p.setS(f, v); } };
  },
  C_OP_RampScalarLinearSimple(d) {
    const rate = d.m_Rate ?? 0, st = d.m_flStartTime ?? 0, et = d.m_flEndTime ?? 1, f = field(d.m_nField, F.Radius);
    return (ps, dt, s, str) => { for (const p of ps) if (p.nage > st && p.nage < et) p.setS(f, p.getS(f) + rate * dt * str); };
  },
  C_OP_RampScalarSpline(d) {
    const r0 = d.m_RateMin ?? 0, r1 = d.m_RateMax ?? 0, f = field(d.m_nField, F.Radius), easeOut = d.m_bEaseOut;
    return (ps, dt, s, str) => { for (const p of ps) { p.setS(f, p.getS(f) + lerp(r0, r1, hash(p.uid, 14)) * dt * str * (easeOut ? 2 * (1 - p.nage) : 2 * p.nage)); } };
  },
  C_OP_SpinUpdate: () => (ps, dt, s, str) => { for (const p of ps) p.rot.addScaledVector(p.rotSpeed, dt * str); },
  C_OP_OscillateVector(d) {
    const out = field(d.m_nField, F.Position), rMin = vec(d.m_RateMin), rMax = vec(d.m_RateMax), fMin = vec(d.m_FrequencyMin, [1, 1, 1]), fMax = vec(d.m_FrequencyMax, [1, 1, 1]);
    const mult = number(d.m_flOscMult, 2), add = number(d.m_flOscAdd, 0.5), prop = d.m_bProportional !== false, offsets = d.m_bOffset && out === F.Position;
    return (ps, dt, s, str) => { for (const p of ps) { const m = mult(p, s), o = add(p, s), v = new THREE.Vector3();
      for (let i = 0; i < 3; i++) { const r = lerp(rMin.getComponent(i), rMax.getComponent(i), hash(p.uid, 30 + i)), fq = lerp(fMin.getComponent(i), fMax.getComponent(i), hash(p.uid, 40 + i));
        const ph = prop ? p.nage * fq * m + o : fq * (m * s.age + o); v.setComponent(i, r * str * dt * Math.sin(Math.PI * ph)); }
      p.getV(out).add(v); if (out === F.Color) p.color.clampScalar(0, 1); if (offsets) p.prev.add(v); } };
  },
  C_OP_OscillateScalarSimple(d) {
    const rate = d.m_Rate ?? 0, freq = d.m_Frequency ?? 1, f = field(d.m_nField, F.Alpha), mult = d.m_flOscMult ?? 2, add = d.m_flOscAdd ?? 0.5;
    return (ps, dt, s, str) => { const v = rate * dt * str * Math.sin(Math.PI * freq * (mult * s.age + add)); for (const p of ps) { let x = p.getS(f) + v; if (f === F.Alpha) x = saturate(x); p.setS(f, x); } };
  },
  C_OP_NormalLock(d) { return () => {}; },
  // A force generator: a pull toward a control point (a push if negative), falling off with distance.
  C_OP_AttractToControlPoint(d) {
    const tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0), amount = number(d.m_fForceAmount, 100), min = number(d.m_fForceAmountMin), useMin = d.m_bApplyMinForce, fall = d.m_fFalloffPower ?? 2, scale = vec(d.m_vecComponentScale, [1, 1, 1]);
    return (ps, dt, s, str) => { const c = translation(tr(s)), k = scale.clone().multiplyScalar(str);
      for (const p of ps) { const dir = c.clone().sub(p.pos), dist = dir.length(); if (dist < 1e-6) continue; let a = amount(p, s); if (useMin) a = Math.max(a, min(p, s));
        p.force.add(dir.divideScalar(dist).multiplyScalar(a / Math.pow(dist, fall)).multiply(k)); } };
  },
  C_OP_DistanceToCP(d) {
    const i0 = number(d.m_flInputMin), i1 = number(d.m_flInputMax, 128), o0 = number(d.m_flOutputMin), o1 = number(d.m_flOutputMax, 1), cp = d.m_nStartCP ?? 0, out = field(d.m_nFieldOutput, F.Radius), method = d.m_nSetMethod;
    return (ps, dt, s) => { for (const p of ps) { const dist = s.cp(cp).pos.distanceTo(p.pos); p.setS(out, setMethod(p, out, remapClamped(dist, i0(p, s), i1(p, s), o0(p, s), o1(p, s)), method)); } };
  },
  C_OP_SetFloatAttributeToVectorExpression(d) {
    const a = vector(d.m_vInput1), b = vector(d.m_vInput2), out = field(d.m_nOutputField, F.ScratchFloat), e = d.m_nExpression;
    return (ps, dt, s) => { for (const p of ps) { const x = a(p, s), y = b(p, s); p.setS(out, e === 'VECTOR_FLOAT_EXPRESSION_DISTANCE' ? x.distanceTo(y) : e === 'VECTOR_FLOAT_EXPRESSION_DOTPRODUCT' ? x.dot(y) : x.length()); } };
  },
  // Model-bound: particles ride the bones they were created on or the snapshot points they came from.
  C_OP_SnapshotSkinToBones(d) {
    const f0 = d.m_flLifeTimeFadeStart ?? 0, f1 = d.m_flLifeTimeFadeEnd ?? 0, cp = d.m_nControlPointNumber ?? 0;
    // A particle keeps to the snapshot it was born from (a parent's on its control point, maybe).
    return (ps, dt, s) => { const snap = s.snapshot(cp);
      // Without a snapshot, those born on an item's surface keep to their point of it.
      if (!snap && !ps.some((p) => p.snapFrom)) { for (const p of ps) { if (!p.surface) continue; const k = f1 > f0 ? 1 - saturate(remap(p.nage, f0, f1)) : 1; if (k <= 0) continue; const delta = p.surface().clone().sub(p.pos).multiplyScalar(k); p.pos.add(delta); p.prev.add(delta); } return; }
      for (const p of ps) { if (p.snap < 0) continue; const k = f1 > f0 ? 1 - saturate(remap(p.nage, f0, f1)) : 1; if (k <= 0) continue;
      const target = (p.snapFrom || snap).point(p.snap); const delta = target.sub(p.pos).multiplyScalar(k); p.pos.add(delta); p.prev.add(delta); } };
  },
  C_OP_SnapshotRigidSkinToBones(d) { return OP.C_OP_SnapshotSkinToBones(d); },
  C_OP_LockToBone(d) {
    const f0 = d.m_flLifeTimeFadeStart ?? 0, f1 = d.m_flLifeTimeFadeEnd ?? 0;
    return (ps, dt, s) => { const m = s.model; if (!m) return; for (const p of ps) { if (!p.bone) continue; const now = m.boneMatrix(p.bone);
      if (!p.boneLocal) { p.boneLocal = p.pos.clone().applyMatrix4(now.clone().invert()); continue; }
      const k = f1 > f0 ? 1 - saturate(remap(p.nage, f0, f1)) : 1; const target = p.boneLocal.clone().applyMatrix4(now); const delta = target.sub(p.pos).multiplyScalar(k); p.pos.add(delta); p.prev.add(delta); } };
  },
  // Particles placed from a bone's snapshot ride that bone; others move with the control point.
  C_OP_MovementRigidAttachToCP(d) {
    const cp = d.m_nControlPointNumber ?? 0; let prev = null;
    return (ps, dt, s) => {
      const m = s.cp(cp).matrix(), lock = prev ? m.clone().multiply(prev.clone().invert()) : null; prev = m.clone();
      for (const p of ps) {
        if (p.bone && s.model) { const now = s.model.boneMatrix(p.bone); if (p.boneLast) { const move = now.clone().multiply(p.boneLast.clone().invert()); p.pos.applyMatrix4(move); p.prev.applyMatrix4(move); } p.boneLast = now; continue; }
        if (lock) { p.pos.applyMatrix4(lock); p.prev.applyMatrix4(lock); }
      }
    };
  },
  // Control points for this system and its children.
  C_OP_SetSingleControlPointPosition(d) {
    const cp = d.m_nCP1 ?? 1, pos = vector(d.m_vecCP1Pos, [128, 0, 0]), once = d.m_bSetOnce, world = d.m_bUseWorldLocation, head = d.m_nHeadLocation ?? 0; let done = false;
    // From the head point, unturned: the offset is as often a value as a place (Ravenblight's CP 2 =
    // 1, 0, 0 turns its gold on), and the hero's turn on the turntable is no turn of the game's.
    return (ps, dt, s) => { if (once && done) return; const v = pos(null, s).clone(); if (!world) v.add(s.cp(head).pos); s.setCP(cp, v); done = true; };
  },
  C_OP_SetControlPointPositions(d) {
    const cps = [[d.m_nCP1 ?? 1, d.m_vecCP1Pos ?? [128, 0, 0]], [d.m_nCP2 ?? 2, d.m_vecCP2Pos ?? [0, 128, 0]], [d.m_nCP3 ?? 3, d.m_vecCP3Pos ?? [-128, 0, 0]], [d.m_nCP4 ?? 4, d.m_vecCP4Pos ?? [0, -128, 0]]];
    const once = d.m_bSetOnce, world = d.m_bUseWorldLocation, head = d.m_nHeadLocation ?? 0; let done = false;
    return (ps, dt, s) => { if (once && done) return; const m = world ? new THREE.Matrix4() : s.cp(head).matrix(); for (const [cp, v] of cps) s.setCP(cp, vec(v).applyMatrix4(m)); done = true; };
  },
  C_OP_SetControlPointOrientation(d) {
    const cp = d.m_nCP ?? 1, rot = vec(d.m_vecRotation), world = d.m_bUseWorldLocation, head = d.m_nHeadLocation ?? 0;
    return (ps, dt, s) => { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.z * Math.PI / 180, rot.x * Math.PI / 180, rot.y * Math.PI / 180, 'ZYX'));
      if (s.parentTurns?.has(cp)) return;
      if (!world) q.premultiply(s.cp(head).quat); s.setCPRotation(cp, q); };
  },
  C_OP_SetParentControlPointsToChildCP(d) {
    const childCP = d.m_nChildControlPoint ?? 0, count = d.m_nNumControlPoints ?? 1, first = d.m_nFirstSourcePoint ?? 0, group = d.m_nChildGroupID ?? 0, orient = d.m_bSetOrientation;
    return (ps, dt, s) => { const kids = s.sim.children.filter((c) => c.groupId === group); for (let i = 0; i < Math.min(count, kids.length); i++) { const src = s.cp(first + i); kids[i].state.override(childCP, src.pos, orient ? src.quat : null, true); } };
  },
  // Each child gets a control point at one of this system's particles. With m_bSetOrientation it
  // takes the particle's orientation: particles locked to a control point with its rotation (the
  // arcana's head points, locked to attach_head) turn with that point, so they carry its axes
  // (x up the head: the head flames rise and trail back); others face along their normal (Source's
  // VectorVectors basis).
  C_OP_SetPerChildControlPoint(d) {
    const first = d.m_nFirstControlPoint ?? 0, group = d.m_nChildGroupID ?? 0, orient = d.m_bSetOrientation, byCount = d.m_bNumBasedOnParticleCount;
    let lockCP;
    return (ps, dt, s) => {
      if (lockCP === undefined) { const lock = (s.sim.def.m_Operators || []).find((o) => o._class === 'C_OP_PositionLock' && o.m_bLockRot && !o.m_bDisableOperator); lockCP = lock ? lock.m_TransformInput?.m_nControlPoint ?? lock.m_nControlPointNumber ?? 0 : null; }
      const kids = s.sim.children.filter((c) => c.groupId === group), n = byCount ? Math.min(kids.length, ps.length) : kids.length;
      for (let i = 0; i < n; i++) { const p = ps[i % Math.max(1, ps.length)]; if (!p) break;
        kids[i].state.override(first, p.pos, orient ? (lockCP !== null ? s.cp(lockCP).quat.clone() : forwardBasis(p.normal)) : null); }
    };
  },
  C_OP_SetControlPointFromObjectScale(d) { const out = d.m_nCPOutput ?? 1; return (ps, dt, s) => s.setCP(out, new THREE.Vector3(1, 1, 1)); },
  C_OP_FadeAndKill(d) {
    const si = d.m_flStartFadeInTime ?? 0, ei = d.m_flEndFadeInTime ?? 0.5, so = d.m_flStartFadeOutTime ?? 0.5, eo = d.m_flEndFadeOutTime ?? 1, a0 = d.m_flStartAlpha ?? 1, a1 = d.m_flEndAlpha ?? 0;
    return (ps) => { for (const p of ps) { const t = p.nage, init = p.initS(F.Alpha); if (t >= 1) { p.dead = true; continue; }
      if (t < ei && ei > si) p.alpha = init * lerp(a0, 1, saturate(remap(t, si, ei))); else if (t > so && eo > so) p.alpha = init * lerp(1, a1, saturate(remap(t, so, eo))); } };
  },
  C_OP_FadeIn(d) {
    const t0 = d.m_flFadeInTimeMin ?? 0.25, t1 = d.m_flFadeInTimeMax ?? 0.25, prop = d.m_bProportional !== false;
    return (ps) => { for (const p of ps) { const t = lerp(t0, t1, hash(p.uid, 93)), x = prop ? p.nage : p.age; if (x < t) p.alpha = (x / t) * p.initS(F.Alpha); } };
  },
  C_OP_Spin(d) {
    const rate = (d.m_nSpinRateDegrees ?? 0) * Math.PI / 180, min = (d.m_nSpinRateMinDegrees ?? 0) * Math.PI / 180, stop = d.m_fSpinRateStopTime ?? 0;
    return (ps, dt, s, str) => { for (const p of ps) { let r = rate; if (stop > 0) r = Math.max(min, rate * (1 - saturate(p.age / stop))); p.rot.z += r * dt * str; } };
  },
  C_OP_SpinYaw(d) { const rate = (d.m_nSpinRateDegrees ?? 0) * Math.PI / 180; return (ps, dt, s, str) => { for (const p of ps) p.rot.x += rate * dt * str; }; },
  C_OP_OscillateScalar(d) {
    const r0 = d.m_RateMin ?? 0, r1 = d.m_RateMax ?? 0, f0 = d.m_FrequencyMin ?? 1, f1 = d.m_FrequencyMax ?? 1, f = field(d.m_nField, F.Alpha), prop = d.m_bProportional !== false, mult = d.m_flOscMult ?? 2, add = d.m_flOscAdd ?? 0.5;
    const s0 = d.m_flStartTime_min ?? 0, s1 = d.m_flStartTime_max ?? 0, e0 = d.m_flEndTime_min ?? 1, e1 = d.m_flEndTime_max ?? 1;
    return (ps, dt, s, str) => { for (const p of ps) { const a = lerp(s0, s1, hash(p.uid, 51)), b = lerp(e0, e1, hash(p.uid, 52)); if (p.nage < a || p.nage > b) continue;
      const fq = lerp(f0, f1, hash(p.uid, 53)), ph = prop ? p.nage * fq * mult + add : fq * (mult * s.age + add);
      let x = p.getS(f) + lerp(r0, r1, hash(p.uid, 54)) * str * dt * Math.sin(Math.PI * ph); if (f === F.Alpha) x = saturate(x); p.setS(f, x); } };
  },
  C_OP_SetFloat(d) {
    const v = number(d.m_InputValue), out = field(d.m_nOutputField, F.Radius), method = d.m_nSetMethod, lerpK = number(d.m_Lerp, 1);
    return (ps, dt, s) => { for (const p of ps) { let x = v(p, s); if (ANGLE.has(out) && !/SCALE/.test(method || '')) x *= Math.PI / 180; p.setS(out, lerp(p.getS(out), setMethod(p, out, x, method), lerpK(p, s))); } };
  },
  C_OP_Noise(d) {
    const out = field(d.m_nFieldOutput, F.Radius), lo = d.m_flOutputMin ?? 0, hi = d.m_flOutputMax ?? 1, scale = d.m_fl4NoiseScale ?? 0.1, add = d.m_bAdditive, ts = d.m_flNoiseAnimationTimeScale ?? 0;
    return (ps, dt, s, str) => { for (const p of ps) { const n = (noise3(p.pos.x * scale + ts * s.age, p.pos.y * scale, p.pos.z * scale) + 1) / 2; let v = lerp(lo, hi, saturate(n)); if (ANGLE.has(out)) v *= Math.PI / 180;
      p.setS(out, add ? p.getS(out) + v * dt * str : lerp(p.getS(out), v, str)); } };
  },
  C_OP_InheritFromParentParticles(d) { const init = INIT.C_INIT_InheritFromParentParticles(d); return (ps, dt, s) => { for (const p of ps) init(p, s); }; },
  // Model particles (a prop held for a taunt) sit on a control point and turn with it.
  C_OP_SetToCP(d) {
    const cp = d.m_nControlPointNumber ?? 0, off = vec(d.m_vecOffset), local = d.m_bOffsetLocal;
    return (ps, dt, s) => { const c = s.cp(cp), o = local ? off.clone().applyQuaternion(c.quat) : off; for (const p of ps) { p.pos.copy(c.pos).add(o); p.prev.copy(p.pos); } };
  },
  C_OP_RemapCPOrientationToRotations(d) {
    // m_vecRotation is a QAngle in the point's frame: pitch, yaw, roll in degrees (Terrorblade's blade
    // planes: roll 90 lays them along the swords, as the game's weapon icon shows them).
    const cp = d.m_TransformInput?.m_nControlPoint ?? d.m_nCP ?? 0, offset = angles(vec(d.m_vecRotation));
    return (ps, dt, s) => { const q = s.cp(cp).quat.clone().multiply(offset), e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
      for (const p of ps) { p.orient = q.clone(); p.rot.set(e.z, e.y, e.x); } };
  },
  C_OP_RemapCPtoScalar(d) {
    const cp = d.m_nCPInput ?? 0, comp = d.m_nField ?? 0, i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, o0 = d.m_flOutputMin ?? 0, o1 = d.m_flOutputMax ?? 1, out = field(d.m_nFieldOutput, F.Radius), method = d.m_nSetMethod;
    const st = d.m_flStartTime ?? -1, et = d.m_flEndTime ?? -1;
    return (ps, dt, s) => { const x = s.cp(cp).pos.getComponent(Math.min(2, comp)); let v = remapClamped(x, i0, i1, o0, o1); if (ANGLE.has(out)) v *= Math.PI / 180;
      for (const p of ps) { if (st >= 0 && et > st && (p.nage < st || p.nage > et)) continue; p.setS(out, setMethod(p, out, v, method)); } };
  },
  C_OP_StopAfterCPDuration(d) {
    const dur = number(d.m_flDuration, 1), destroy = d.m_bDestroyImmediately;
    return (ps, dt, s) => { if (s.age < dur(null, s)) return; s.sim.root.stopEmission(); if (destroy) for (const p of ps) p.dead = true; };
  },
  C_OP_MovementPlaceOnGround(d) { const off = number(d.m_flOffset); return (ps, dt, s) => { for (const p of ps) { const z = GROUND + off(p, s); p.prev.z += z - p.pos.z; p.pos.z = z; } }; },
  C_OP_LerpScalar(d) {
    const out = field(d.m_nFieldOutput, F.Radius), target = number(d.m_flOutput), st = d.m_flStartTime ?? 0, et = d.m_flEndTime ?? 1;
    return (ps, dt, s) => { for (const p of ps) { if (p.nage < st) continue; let v = target(p, s); if (ANGLE.has(out)) v *= Math.PI / 180; p.setS(out, lerp(p.initS(out), v, saturate(remap(p.nage, st, et)))); } };
  },
  C_OP_MaxVelocity(d) { const max = d.m_flMaxVelocity ?? 0; return (ps, dt) => { if (max <= 0 || dt <= 0) return; for (const p of ps) { const v = p.pos.clone().sub(p.prev), l = v.length() / dt; if (l > max) p.prev.copy(p.pos).sub(v.multiplyScalar(max / l)); } }; },
  C_OP_ClampScalar(d) { const out = field(d.m_nFieldOutput, F.Radius), lo = number(d.m_flOutputMin), hi = number(d.m_flOutputMax, 1); return (ps, dt, s) => { for (const p of ps) p.setS(out, Math.min(Math.max(p.getS(out), lo(p, s)), hi(p, s))); }; },
  // Children are on unless an operator turns them off; these are the defaults.
  // Particles faded out below a minimum alpha die (systems without C_OP_Decay end their particles so).
  C_OP_AlphaDecay(d) { const min = d.m_flMinAlpha ?? 0; return (ps) => { for (const p of ps) if (p.alpha <= min && p.age > 0) p.dead = true; }; },
  C_OP_EnableChildrenFromParentParticleCount: () => () => {},
  // Starts a group of children again and again (their emitters from the start), every refire time.
  C_OP_RepeatedTriggerChildGroup(d) {
    const group = d.m_nChildGroupID ?? 0, refire = number(d.m_flClusterRefireTime, 1), cooldown = number(d.m_flClusterCooldown, 0); let t = 0;
    return (ps, dt, s) => { t += dt; if (t < refire(null, s) + cooldown(null, s)) return; t = 0;
      for (const k of s.sim.children) if (k.groupId === group) for (const sim of k.all()) { sim.stopped = false; for (const e of sim.emitters) e.fn.reset?.(); } };
  },
  // A particle (the first, the last or a numbered one) held at a control point, with an offset.
  C_OP_PinParticleToCP(d) {
    const cp = d.m_nControlPoint ?? 0, off = vector(d.m_vecOffset), local = d.m_bOffsetLocal, sel = d.m_nParticleSelection || 'PARTICLE_SELECTION_FIRST', num = number(d.m_nParticleNumber, 0);
    return (ps, dt, s) => { if (!ps.length) return; const p = sel === 'PARTICLE_SELECTION_LAST' ? ps[ps.length - 1] : sel === 'PARTICLE_SELECTION_NUMBER' ? ps[Math.min(ps.length - 1, Math.max(0, Math.floor(num(null, s))))] : ps[0];
      const c = s.cp(cp), o = off(p, s).clone(); if (local) o.applyQuaternion(c.quat); p.pos.copy(c.pos).add(o); p.prev.copy(p.pos); };
  },
  C_OP_InheritFromParentParticlesV2(d) { return OP.C_OP_InheritFromParentParticles(d); },
  C_OP_OscillateVectorSimple(d) {
    return OP.C_OP_OscillateVector({ ...d, m_RateMin: d.m_Rate, m_RateMax: d.m_Rate, m_FrequencyMin: d.m_Frequency ?? [1, 1, 1], m_FrequencyMax: d.m_Frequency ?? [1, 1, 1], m_bProportional: false });
  },
  // A vector field pointing from the particle to a control point.
  C_OP_RemapDirectionToCPToVector(d) {
    const cp = d.m_nCP ?? 0, out = field(d.m_nFieldOutput, F.Normal), scale = d.m_flScale ?? 1, normalize = d.m_bNormalize;
    return (ps, dt, s) => { const c = s.cp(cp).pos; for (const p of ps) { const v = c.clone().sub(p.pos); if (normalize) v.normalize(); p.setV(out, v.multiplyScalar(scale)); } };
  },
  // The difference of a field from the previous particle's, remapped.
  C_OP_DifferencePreviousParticle(d) {
    const fin = field(d.m_nFieldInput, F.Radius), out = field(d.m_nFieldOutput, F.Radius), i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, o0 = d.m_flOutputMin ?? 0, o1 = d.m_flOutputMax ?? 1, method = d.m_nSetMethod, active = d.m_bActiveRange;
    return (ps) => { for (let i = 1; i < ps.length; i++) { const x = ps[i].getS(fin) - ps[i - 1].getS(fin); if (active && (x < i0 || x > i1)) continue; ps[i].setS(out, setMethod(ps[i], out, remapClamped(x, i0, i1, o0, o1), method)); } };
  },
  // How far along from one control point to another a particle is, remapped into a field.
  C_OP_PercentageBetweenCPs(d) {
    const out = field(d.m_nFieldOutput, F.Alpha), i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, o0 = d.m_flOutputMin ?? 0, o1 = d.m_flOutputMax ?? 1, a = d.m_nStartCP ?? 0, b = d.m_nEndCP ?? 1, method = d.m_nSetMethod, active = d.m_bActiveRange, radial = d.m_bRadialCheck !== false;
    return (ps, dt, s) => { const A = s.cp(a).pos, B = s.cp(b).pos, seg = B.clone().sub(A), len2 = Math.max(1e-6, seg.lengthSq());
      for (const p of ps) { const x = radial ? p.pos.distanceTo(A) / Math.sqrt(len2) : p.pos.clone().sub(A).dot(seg) / len2; if (active && (x < i0 || x > i1)) continue; p.setS(out, setMethod(p, out, remapClamped(x, i0, i1, o0, o1), method)); } };
  },
  // The world, here the ground under the hero: particles stop at it, bouncing back by the bounce amount.
  C_OP_WorldTraceConstraint(d) {
    const radius = number(d.m_flCollisionRadius ?? d.m_flRadiusScale, 0), bounce = number(d.m_flBounceAmount, 0), slide = number(d.m_flSlideAmount, 0);
    return (ps, dt, s) => { let moved = false;
      for (const p of ps) { const floor = GROUND + radius(p, s); if (p.pos.z >= floor) continue;
        const vz = p.pos.z - p.prev.z; p.pos.z = floor; p.prev.z = floor + vz * bounce(p, s); const k = slide(p, s); p.prev.x = lerp(p.pos.x, p.prev.x, k); p.prev.y = lerp(p.pos.y, p.prev.y, k); moved = true; }
      return moved; };
  },
  C_OP_DistanceCull(d) {
    const cp = d.m_nControlPointNumber ?? 0, dist = d.m_flDistance ?? 0, inside = d.m_bCullInside, off = vec(d.m_vecPointOffset);
    return (ps, dt, s) => { const c = s.cp(cp).pos.clone().add(off); for (const p of ps) { const far = p.pos.distanceTo(c) > dist; if (far !== !!inside) p.dead = true; } };
  },
  C_OP_MovementRotateParticleAroundAxis(d) {
    const axis = vec(d.m_vecRotAxis, [0, 0, 1]).normalize(), rate = number(d.m_flRotRate, 180), cp = d.m_TransformInput?.m_nControlPoint ?? d.m_nCP ?? 0, local = d.m_bLocalSpace;
    return (ps, dt, s, str) => { const c = s.cp(cp), ax = local ? axis.clone().applyQuaternion(c.quat) : axis, q = new THREE.Quaternion().setFromAxisAngle(ax, rate(null, s) * Math.PI / 180 * dt * str);
      for (const p of ps) { p.pos.sub(c.pos).applyQuaternion(q).add(c.pos); p.prev.sub(c.pos).applyQuaternion(q).add(c.pos); } };
  },
  // A control point's position as a vector field (an item's prismatic gem: its colour in CP 15 scales
  // the particles' colour, at the strength CP 16 gives); set like a scalar (scale or add to the initial).
  C_OP_RemapCPtoVector(d) {
    const cp = d.m_nCPInput ?? 0, out = field(d.m_nFieldOutput, F.Color), i0 = vec(d.m_vInputMin), i1 = vec(d.m_vInputMax, [1, 1, 1]), o0 = vec(d.m_vOutputMin), o1 = vec(d.m_vOutputMax, [1, 1, 1]), method = d.m_nSetMethod;
    return (ps, dt, s, str = 1) => {
      const x = s.cp(cp).pos, v = new THREE.Vector3(...[0, 1, 2].map((k) => remapClamped(x.getComponent(k), i0.getComponent(k), i1.getComponent(k), o0.getComponent(k), o1.getComponent(k))));
      for (const p of ps) {
        const base = /INITIAL/.test(method || '') ? p.initV(out) : p.getV(out), to = /SCALE/.test(method || '') ? base.clone().multiply(v) : /ADD/.test(method || '') ? base.clone().add(v) : v.clone();
        p.setV(out, p.getV(out).clone().lerp(to, Math.min(1, str)));
      }
    };
  },
  C_OP_DampenToCP(d) {
    const cp = d.m_nControlPointNumber ?? 0, range = d.m_flRange ?? 100, scale = d.m_flScale ?? 1;
    return (ps, dt, s) => { const c = s.cp(cp).pos; for (const p of ps) { const dist = p.pos.distanceTo(c); if (dist > range) continue; const k = lerp(1, 1 - scale, 1 - dist / range), step = p.pos.clone().sub(p.prev).multiplyScalar(k); p.prev.copy(p.pos).sub(step); } };
  },
  C_OP_MaintainSequentialPath(d) {
    const params = d.m_PathParams, n = Math.max(1, d.m_flNumToAssign ?? 100), loop = d.m_bLoop !== false;
    return (ps, dt, s) => { ps.forEach((p, i) => { const t = p.pathT ?? (n > 1 ? (i % n) / (loop ? n : n - 1) : 0); p.pos.copy(pathPoint(params, t, s)); p.prev.copy(p.pos); }); };
  },
  C_OP_Orient2DRelToCP(d) {
    const cp = d.m_nCP ?? 0, off = (d.m_flRotOffset ?? 0) * Math.PI / 180, spin = d.m_flSpinStrength ?? 1, out = field(d.m_nFieldOutput, F.Yaw);
    return (ps, dt, s) => { const c = s.cp(cp).pos; for (const p of ps) { const v = c.clone().sub(p.pos); p.setS(out, lerp(p.getS(out), Math.atan2(v.y, v.x) + off, spin)); } };
  },
  C_OP_SetControlPointToCenter(d) {
    const out = d.m_nCP1 ?? 1, off = vec(d.m_vecCP1Pos);
    return (ps, dt, s) => { if (!ps.length) return; const c = new THREE.Vector3(); for (const p of ps) c.add(p.pos); s.setCP(out, c.divideScalar(ps.length).add(off)); };
  },
  C_OP_SetChildControlPoints(d) {
    const group = d.m_nChildGroupID ?? 0, first = d.m_nFirstControlPoint ?? 0, count = d.m_nNumControlPoints ?? 1, src = d.m_nFirstSourcePoint ?? 0, orient = d.m_bSetOrientation;
    return (ps, dt, s) => { const kids = s.sim.children.filter((c) => c.groupId === group); for (const k of kids) for (let i = 0; i < count; i++) { const p = ps[src + i]; if (p) k.state.override(first + i, p.pos, orient ? forwardBasis(p.normal) : null); } };
  },
  // The system's own control points on its particles (each child takes them as its own): Bane's
  // Slumbering Terror puts its orbs' CP 3 on each arm's streak.
  C_OP_SetControlPointsToParticle(d) {
    const first = d.m_nFirstControlPoint ?? 1, count = d.m_nNumControlPoints ?? 1, src = d.m_nFirstSourcePoint ?? 0, orient = d.m_bSetOrientation;
    return (ps, dt, s) => { for (let i = 0; i < count; i++) { const p = ps[src + i]; if (!p) continue; s.setCP(first + i, p.pos); if (orient) s.setCPRotation(first + i, forwardBasis(p.normal)); } };
  },
  C_OP_RotateVector(d) {
    const out = field(d.m_nFieldOutput, F.Normal), a0 = vec(d.m_vecRotAxisMin, [0, 0, 1]), a1 = vec(d.m_vecRotAxisMax, [0, 0, 1]), r0 = d.m_flRotRateMin ?? 180, r1 = d.m_flRotRateMax ?? 180, normalize = d.m_bNormalize;
    return (ps, dt, s, str) => { for (const p of ps) { const ax = a0.clone().lerp(a1, hash(p.uid, 61)).normalize(), q = new THREE.Quaternion().setFromAxisAngle(ax, lerp(r0, r1, hash(p.uid, 62)) * Math.PI / 180 * dt * str); const v = p.getV(out).applyQuaternion(q); if (normalize) v.normalize(); } };
  },
  // Set as the method says, eased in by m_Lerp and the operator's strength (a gem's CP, a colour's switch).
  C_OP_SetVec(d) {
    const v = vector(d.m_InputValue), out = field(d.m_nOutputField, F.Color), method = d.m_nSetMethod, lerpK = number(d.m_Lerp, 1);
    return (ps, dt, s, k = 1) => { for (const p of ps) { const to = setVMethod(p, out, v(p, s), method, dt), t = lerpK(p, s) * Math.min(1, k); p.setV(out, t >= 1 ? to : p.getV(out).clone().lerp(to, t)); } };
  },
  // The end cap (the effect stopped): its particles go after a time, a value going to another first.
  // Nothing before it, whatever the operator's end-cap state says (Marci's basket marks none).
  C_OP_EndCapTimedDecay(d) { const time = d.m_flDecayTime ?? 1; return (ps, dt, s) => { if (s.endedAt !== undefined && s.age - s.endedAt >= time) for (const p of ps) p.dead = true; }; },
  C_OP_LerpEndCapScalar(d) {
    const out = field(d.m_nFieldOutput, F.Alpha), to = d.m_flOutput ?? 1, time = d.m_flLerpTime ?? 1;
    return (ps, dt, s) => { if (s.endedAt === undefined) return; const k = time > 0 ? saturate((s.age - s.endedAt) / time) : 1; for (const p of ps) { p.capFrom ??= p.getS(out); p.setS(out, lerp(p.capFrom, to, k)); } };
  },
  // Lights, speed-to-CP links: nothing to draw.
  // How fast a control point moves (here: its position's change over the step), remapped into a
  // component of another (Terrorblade's feet flames take their rate from it: at a stand, the minimum).
  C_OP_RemapSpeedtoCP(d) {
    const cpIn = d.m_nInControlPointNumber ?? 0, cpOut = d.m_nOutControlPointNumber ?? -1, f = d.m_nField ?? 0, i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, o0 = d.m_flOutputMin ?? 0, o1 = d.m_flOutputMax ?? 1, deltaV = d.m_bUseDeltaV;
    let last = null, lastV = new THREE.Vector3();
    return (ps, dt, s) => {
      if (cpOut < 0 || f < 0 || f > 2 || dt <= 0) return;
      const pos = s.cp(cpIn).pos, v = last ? pos.clone().sub(last).divideScalar(dt) : new THREE.Vector3(); last = pos.clone();
      const speed = deltaV ? v.distanceTo(lastV) : v.length(); lastV = v;
      const out = s.cp(cpOut).pos.clone(); out.setComponent(f, i0 === i1 ? (speed < i0 ? o0 : o1) : remapClamped(speed, i0, i1, o0, o1)); s.setCP(cpOut, out);
    };
  },
  C_OP_RemapSpeed: () => () => {},
  C_OP_SelectivelyEnableChildren: () => () => {},
  C_OP_RenderDeferredLight: () => () => {},
};

// Force generators (m_ForceGenerators): accelerations added to each particle's force, which the
// movement operator integrates.
Object.assign(OP, {
  C_OP_RandomForce(d) { const a = vec(d.m_MinForce), b = vec(d.m_MaxForce); return (ps, dt, s, str) => { for (const p of ps) p.force.add(new THREE.Vector3(lerp(a.x, b.x, rnd()), lerp(a.y, b.y, rnd()), lerp(a.z, b.z, rnd())).multiplyScalar(str)); }; },
  // Around an axis through a control point (the given one from behaviour version 3): along the
  // particle's direction × the axis, so nothing at the axis' poles.
  C_OP_TwistAroundAxis(d) {
    const amount = d.m_fForceAmount ?? 0, axis = vec(d.m_TwistAxis, [0, 0, 1]), local = d.m_bLocalSpace;
    return (ps, dt, s, str) => {
      const c = s.cp(s.sim.version >= 3 ? d.m_nControlPointNumber ?? 0 : 0), ax = axis.clone(); if (local) ax.applyQuaternion(c.quat); if (ax.lengthSq() > 0) ax.normalize(); else ax.set(0, 0, 1);
      for (const p of ps) { const dir = p.pos.clone().sub(c.pos); if (dir.lengthSq() <= 1e-12) continue; dir.normalize(); const al = 1 - dir.dot(ax); if (al * al <= 1e-12) continue; p.force.add(dir.cross(ax).multiplyScalar(amount * str)); }
    };
  },
  // The noise sampled at the particle (scaled by m_vecNoiseFreq, moving with time) is the force itself.
  C_OP_CurlNoiseForce(d) {
    const type = d.m_nNoiseType ?? (d.m_useCurl ? 'PARTICLE_DIR_NOISE_CURL' : null), freq = vector(d.m_vecNoiseFreq, [0.02, 0.02, 0.02]), scale = vector(d.m_vecNoiseScale, [1000, 1000, 1000]);
    const off = vector(d.m_vecOffset), rate = vector(d.m_vecOffsetRate), seed = number(d.m_flWorleySeed), jit = number(d.m_flWorleyJitter, 0.875);
    return (ps, dt, s, str) => { for (const p of ps) { const q = off(p, s).clone().addScaledVector(rate(p, s), s.age).add(p.pos.clone().multiply(freq(p, s)));
      const n = type === 'PARTICLE_DIR_NOISE_CURL' ? curl3(q) : type === 'PARTICLE_DIR_NOISE_WORLEY_BASIC' ? worleyOffset(q, jit(p, s), seed(p, s)) : valueVector(q);
      p.force.add(n.multiply(scale(p, s)).multiplyScalar(str)); } };
  },
  // Four octaves of vector noise; one of frequency 0 adds the lattice's value at the origin. No strength.
  C_OP_TurbulenceForce(d) {
    const oct = [[1, 1], [0, 0.5], [0, 0.25], [0, 0.125]].map(([f, a], i) => [d[`m_flNoiseCoordScale${i}`] ?? f, vec(d[`m_vecNoiseAmount${i}`], [a, a, a])]);
    return (ps) => { for (const p of ps) for (const [f, a] of oct) p.force.add(valueVector(p.pos.clone().multiplyScalar(f)).multiply(a)); };
  },
  // An acceleration in a control point's axes.
  C_OP_LocalAccelerationForce(d) {
    const cp = d.m_nCP ?? -1, accel = vector(d.m_vecAccel);
    return (ps, dt, s, str) => { for (const p of ps) { const v = accel(p, s).clone(); if (cp >= 0) v.applyQuaternion(s.cp(cp).quat); p.force.add(v.multiplyScalar(str)); } };
  },
  C_OP_PerParticleForce(d) {
    const k = number(d.m_flForceScale, 1), force = vector(d.m_vForce), cp = d.m_nCP ?? -1;
    return (ps, dt, s, str) => { for (const p of ps) { const v = force(p, s).clone(); if (cp >= 0) v.applyQuaternion(s.cp(cp).quat); p.force.add(v.multiplyScalar(k(p, s) * str)); } };
  },
});

// Constraints (m_Constraints): run after the operators, they move particles and say whether they did.
Object.assign(OP, {
  // A particle outside the shell between the two distances from the centre snaps onto it (a negative
  // maximum: no outer shell); its previous position stays, so the snap shows as velocity.
  C_OP_ConstrainDistance(d) {
    const lo = number(d.m_fMinDistance), hi = number(d.m_fMaxDistance, 100), tr = transform(d.m_TransformInput, d.m_nControlPointNumber ?? 0), off = vector(d.m_CenterOffset), global = d.m_bGlobalCenter;
    return (ps, dt, s) => {
      const c = global ? off(null, s).clone() : off(null, s).clone().applyMatrix4(tr(s)), a = lo(null, s), b0 = hi(null, s), b = b0 < 0 ? Infinity : b0; let moved = false;
      for (const p of ps) { const v = p.pos.clone().sub(c), d2 = v.lengthSq(); if ((d2 >= a * a && d2 <= b * b) || d2 === 0) continue; p.pos.copy(c).addScaledVector(v, (d2 < a * a ? a : b) / Math.sqrt(d2)); moved = true; }
      return moved;
    };
  },
  // A soft spring between consecutive particles: each pass a fraction (dt × m_flAdjustmentScale) of a
  // segment's error from the band around the rest length; particles of force scale 0 are pinned. The
  // rest length is m_flInitialRestingLength, or the first chain's length over its particle count.
  C_OP_RopeSpringConstraint(d) {
    const rest = number(d.m_flRestLength, 1), lo = number(d.m_flMinDistance, 0.9), hi = number(d.m_flMaxDistance, 1.1), initial = number(d.m_flInitialRestingLength, -1), adjust = d.m_flAdjustmentScale ?? 15; let base;
    return (ps, dt, s) => {
      if (ps.length < 2) return true;
      let r = initial(null, s); if (r < 0) { if (base === undefined) { let t = 0; for (let i = 1; i < ps.length; i++) t += ps[i].prev.distanceTo(ps[i - 1].prev); base = t / ps.length; } r = base; }
      r *= rest(null, s); if (dt > 0.1) return true;
      const min = lo(null, s) * r, max = hi(null, s) * r, k = dt * adjust;
      for (let i = 1; i < ps.length; i++) {
        const a = ps[i - 1], b = ps[i], v = b.pos.clone().sub(a.pos), len = v.length(), target = len > max ? max : len < min ? min : null; if (target === null) continue;
        const fix = v.multiplyScalar(((target - len) / Math.max(len, 1e-6)) * k), aPinned = a.forceScale === 0;
        if (b.forceScale === 0) { if (!aPinned) a.pos.sub(fix); } else if (aPinned) b.pos.add(fix); else { a.pos.addScaledVector(fix, -0.5); b.pos.addScaledVector(fix, 0.5); }
      }
      return true;
    };
  },
});

// Pre-emission operators: control points.
Object.assign(OP, {
  // Turns a control point about an axis (Z whenever the axis' x is 0, as Source 2 Viewer has it),
  // accumulating on its rotation.
  C_OP_SetControlPointRotation(d) {
    const axis = vector(d.m_vecRotAxis, [0, 0, 1]), rate = number(d.m_flRotRate, 180), cp = d.m_nCP ?? 0, local = d.m_nLocalCP ?? -1;
    return (ps, dt, s) => { const v = axis(null, s), ax = v.x === 0 ? new THREE.Vector3(0, 0, 1) : v.clone().normalize(); if (local > -1) ax.applyQuaternion(s.cp(local).quat);
      s.setCPRotation(cp, s.cp(cp).quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ax, rate(null, s) * Math.PI / 180 * dt)).normalize()); };
  },
  // A random point in a box (in the head control point's frame unless m_bUseWorldLocation), drawn again
  // every m_flReRandomRate seconds (never if negative), the control point going m_flInterpolation of
  // the way to it each step.
  C_OP_SetRandomControlPointPosition(d) {
    const cp = d.m_nCP1 ?? 1, lo = vec(d.m_vecCPMinPos), hi = vec(d.m_vecCPMaxPos), world = d.m_bUseWorldLocation, head = d.m_nHeadLocation ?? 0, orient = d.m_bOrient, rate = number(d.m_flReRandomRate, -1), k = number(d.m_flInterpolation, 1);
    const draw = () => new THREE.Vector3(lerp(lo.x, hi.x, rnd()), lerp(lo.y, hi.y, rnd()), lerp(lo.z, hi.z, rnd())); let at = null, last = -Infinity;
    return (ps, dt, s) => {
      if (!at) at = draw(); const r = rate(null, s), t = last === -Infinity ? 1 : k(null, s);
      if (s.age >= last + r) { at = draw(); last = r < 0 ? Infinity : s.age; }
      setCPValue(s, cp, s.cp(cp).pos.clone().lerp(world ? at.clone() : at.clone().applyMatrix4(s.cp(head).matrix()), t));
      if (orient) s.setCPRotation(cp, forwardBasis(forward(s.cp(head))));
    };
  },
  // The gem colour (control point 60, enabled by 61's x) as a shift from the default colour: hue as a
  // turn, saturation and value as ratios less one.
  C_OP_HSVShiftToCP(d) {
    const color = d.m_nColorCP ?? 60, gem = d.m_nColorGemEnableCP ?? 61, out = d.m_nOutputCP ?? 62, def = hsv(color24(d.m_DefaultHSVColor));
    return (ps, dt, s) => {
      if (cpValue(s, gem).x <= 0) { setCPValue(s, out, new THREE.Vector3()); return; }
      const c = hsv(cpValue(s, color).divideScalar(255)); let dh = (c.x - def.x) / 360; if (dh < 0) dh += 1;
      setCPValue(s, out, new THREE.Vector3(def.y > 0 && def.z > 0 ? dh : 0, (def.y > 0 ? c.y / def.y : 1) - 1, (def.z > 0 ? c.z / def.z : 1) - 1));
    };
  },
  // Line of sight (m_bLOS) would need world traces: never blocked here.
  C_OP_DistanceBetweenCPsToCP(d) {
    const i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 128, o0 = d.m_flOutputMin ?? 0, o1 = d.m_flOutputMax ?? 1, a = d.m_nStartCP ?? 0, b = d.m_nEndCP ?? 1, out = d.m_nOutputCP ?? 2, f = Math.min(2, Math.max(0, d.m_nOutputCPField ?? 0));
    return (ps, dt, s) => { const v = cpValue(s, out); if (f >= 0 && f <= 2) v.setComponent(f, remapClamped(s.cp(a).pos.distanceTo(s.cp(b).pos), i0, i1, o0, o1)); setCPValue(s, out, v); };
  },
  C_OP_SetControlPointToVectorExpression(d) {
    const out = d.m_nOutputCP ?? 2, a = vector(d.m_vInput1), b = vector(d.m_vInput2), k = number(d.m_flLerp);
    const e = { ADD: (x, y) => x.add(y), SUBTRACT: (x, y) => x.sub(y), MUL: (x, y) => x.multiply(y), DIVIDE: (x, y) => x.divide(y), INPUT_1: (x) => x, MIN: (x, y) => x.min(y), MAX: (x, y) => x.max(y),
      CROSSPRODUCT: (x, y) => x.cross(y), LERP: (x, y, s) => x.lerp(y, k(null, s)) }[String(d.m_nExpression ?? 'VECTOR_EXPRESSION_ADD').replace('VECTOR_EXPRESSION_', '')] || (() => new THREE.Vector3());
    return (ps, dt, s) => setCPValue(s, out, e(a(null, s).clone(), b(null, s).clone(), s));
  },
  // A control point moving at a rate drawn once per system.
  C_OP_RampCPLinearRandom(d) {
    const cp = d.m_nOutControlPointNumber ?? 1, lo = vec(d.m_vecRateMin), hi = vec(d.m_vecRateMax);
    return (ps, dt, s) => { const r = new THREE.Vector3(lerp(lo.x, hi.x, hash(s.seed, 211)), lerp(lo.y, hi.y, hash(s.seed, 212)), lerp(lo.z, hi.z, hash(s.seed, 213))); setCPValue(s, cp, cpValue(s, cp).addScaledVector(r, dt)); };
  },
});
function hsv(c) {
  const max = Math.max(c.x, c.y, c.z), ch = max - Math.min(c.x, c.y, c.z), sat = max === 0 ? 0 : ch / max; if (sat === 0) return new THREE.Vector3(0, 0, max);
  let h = 60 * (c.x === max ? (c.y - c.z) / ch : c.y === max ? (c.z - c.x) / ch + 2 : (c.x - c.y) / ch + 4); if (h < 0) h += 360; return new THREE.Vector3(h, sat, max);
}
// How far a point is from start to end: its distance from the start over the length (radial), or
// its projection on the line.
function percentage(x, a, b, radial) {
  if (radial) return 1 / ((a.distanceTo(b) + EPSILON) / (x.distanceTo(a) + EPSILON));
  const ax = b.clone().sub(a), l2 = ax.lengthSq(); return l2 < 1e-5 ? 0 : ax.dot(x.clone().sub(a)) / l2;
}
// A remap's outputs, saturated when they are an alpha.
const outputs = (out, a, b) => (out === F.Alpha || out === F.AlphaAlternate ? [saturate(a), saturate(b)] : [a, b]);

Object.assign(OP, {
  C_OP_RemapControlPointDirectionToVector(d) { const out = field(d.m_nFieldOutput, F.Position), scale = d.m_flScale ?? 1, cp = d.m_nControlPointNumber ?? 0; return (ps, dt, s) => { const v = forward(s.cp(cp)).multiplyScalar(scale); for (const p of ps) p.setV(out, v); }; },
  // A triangle wave over the cycle (start, end, start); not repeating, start to end once and held.
  C_OP_CycleScalar(d) {
    const out = field(d.m_nDestField, F.Alpha), a0 = d.m_flStartValue ?? 0, b0 = d.m_flEndValue ?? 1, time = d.m_flCycleTime ?? 1, once = d.m_bDoNotRepeatCycle, sync = d.m_bSynchronizeParticles;
    const cp = d.m_nCPScale ?? -1, fmin = d.m_nCPFieldMin ?? 0, fmax = d.m_nCPFieldMax ?? 0, method = d.m_nSetMethod, rate = (once ? 0.5 : 1) / Math.max(EPSILON, time), clamp = once ? time : Infinity;
    const component = (v, i) => (i >= 0 && i <= 2 ? v.getComponent(i) : 0);
    return (ps, dt, s, str) => {
      let a = a0, b = b0; if (cp >= 0) { const c = s.cp(cp).pos; if (fmin >= 0) a *= component(c, fmin); if (fmax >= 0) b *= component(c, fmax); }
      for (const p of ps) { let ph = Math.min(sync ? s.age : p.age, clamp) * rate; ph -= Math.floor(ph); p.setS(out, lerp(p.getS(out), setMethod(p, out, a + (b - a) * 2 * Math.min(ph, 1 - ph), method, dt), str)); }
    };
  },
  // Particles placed along a path with m_bSaveOffset keep their place on it as its control points move.
  C_OP_LockToSavedSequentialPath(d) {
    const pp = d.m_PathParams, a = clampCP(pp?.m_nStartControlPointNumber ?? 0), b = clampCP(pp?.m_nEndControlPointNumber ?? 0), pairs = d.m_bCPPairs, n = pairs ? Math.max(b - a, 1) : 1, prev = [];
    return (ps, dt, s) => {
      const cur = Array.from({ length: n }, (_, i) => pathValues(pp, s, pairs ? a + i : a, pairs ? a + i + 1 : b)); cur.forEach((v, i) => { prev[i] ??= v; });
      for (const p of ps) { const i = Math.min(n - 1, Math.max(0, Math.trunc(p.hbo.y - a))), delta = pathAt(cur[i], p.hbo.x).sub(pathAt(prev[i], p.hbo.x)).multiplyScalar(dt > 0 ? Math.min(p.age, dt) / dt : 1); p.pos.add(delta); p.prev.add(delta); }
      cur.forEach((v, i) => { prev[i] = v; });
    };
  },
  // The same, each particle on the segment it saved (start, end).
  C_OP_LockToSavedSequentialPathV2(d) {
    const pp = d.m_PathParams, a = clampCP(pp?.m_nStartControlPointNumber ?? 0), b = clampCP(pp?.m_nEndControlPointNumber ?? 0), pairs = d.m_bCPPairs && Math.abs(b - a) > 1; let prev = new Map();
    return (ps, dt, s) => {
      const cur = new Map();
      for (const p of ps) { const i = clampCP(Math.trunc(p.hbo.y)); if (!cur.has(i)) { cur.set(i, pathValues(pp, s, i, pairs ? Math.trunc(p.hbo.z) : b)); if (!prev.has(i)) prev.set(i, cur.get(i)); }
        const delta = pathAt(cur.get(i), p.hbo.x).sub(pathAt(prev.get(i), p.hbo.x)).multiplyScalar(dt > 0 ? Math.min(p.age, dt) / dt : 1); p.pos.add(delta); p.prev.add(delta); }
      prev = cur;
    };
  },
  // A tiny z first: a vector of no length points up.
  C_OP_NormalizeVector(d) { const out = field(d.m_nFieldOutput, F.Position), scale = d.m_flScale ?? 1; return (ps) => { for (const p of ps) { const v = p.getV(out).clone(); v.z += EPSILON; p.setV(out, v.normalize().multiplyScalar(scale)); } }; },
  // The position pair holds the previous step's movement: the previous step's time makes it per second.
  C_OP_RemapVelocityToVector(d) {
    const out = field(d.m_nFieldOutput, F.Position), scale = d.m_flScale ?? 1, normalize = d.m_bNormalize; if (out === F.Position || out === F.PositionPrevious) return null;
    return (ps, dt, s) => { const k = scale / Math.max(1e-20, s.prevDt); for (const p of ps) { const v = p.pos.clone().sub(p.prev); if (!normalize) p.setV(out, v.multiplyScalar(k)); else if (v.lengthSq() > 0) p.setV(out, v.normalize().multiplyScalar(scale)); } };
  },
  // A transform's rotation as the particle's angles (or forward as its normal): with m_bUseQuat turned
  // first by m_vecRotation (pitch, yaw, roll = y, z, x), else its forward's angles plus it (x, y, z).
  C_OP_RemapTransformOrientationToRotations(d) {
    const tr = transform(d.m_TransformInput, 0), rot = vec(d.m_vecRotation).multiplyScalar(Math.PI / 180), quat = d.m_bUseQuat, normal = d.m_bWriteNormal, offset = qangle(rot.y, rot.z, rot.x);
    return (ps, dt, s) => {
      const q = new THREE.Quaternion().setFromRotationMatrix(tr(s)); let ang, fwd;
      if (quat) { const r = offset.clone().multiply(q); ang = eulerAngles(r); fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(r); }
      else { ang = forwardAngles(new THREE.Vector3(1, 0, 0).applyQuaternion(q)).add(rot); fwd = new THREE.Vector3(Math.cos(ang.x) * Math.cos(ang.y), Math.cos(ang.x) * Math.sin(ang.y), -Math.sin(ang.x)); }
      for (const p of ps) { if (normal) p.setV(F.Normal, fwd); else { p.setS(F.Pitch, ang.x); p.setS(F.Yaw, ang.y); p.setS(F.Roll, ang.z); } }
    };
  },
  C_OP_RemapTransformOrientationToYaw(d) {
    const tr = transform(d.m_TransformInput, 0), out = field(d.m_nFieldOutput, F.Yaw), off = (d.m_flRotOffset ?? 0) * Math.PI / 180, spin = d.m_flSpinStrength ?? 1;
    return (ps, dt, s, str) => { const f = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(tr(s))), yaw = Math.atan2(f.y, f.x) + Math.PI + off;
      for (const p of ps) { const c = p.getS(out); p.setS(out, c + (yaw - c) * str * spin); } };
  },
  // In the end cap, particles whose life is no longer than the end cap's age (counted, as Source 2
  // Viewer counts it, from twice the time it began) go.
  // A particle goes once the end cap has lasted its lifespan (VRF takes the end cap's start off twice).
  C_OP_EndCapDecay: () => (ps, dt, s) => { if (s.endedAt === undefined) return; const t = s.age - s.endedAt; for (const p of ps) if (p.life <= 0 || p.life <= t) p.dead = true; },
  // Each particle fades to its own colour between the two: a draw per channel when eased, one along the line when not.
  C_OP_ColorInterpolateRandom(d) {
    const lo = color24(d.m_ColorFadeMin), hi = color24(d.m_ColorFadeMax), st = d.m_flFadeStartTime ?? 0, et = d.m_flFadeEndTime ?? 1, out = field(d.m_nFieldOutput, F.Color), ease = d.m_bEaseInOut !== false;
    return (ps) => { if (et === st) return; for (const p of ps) {
      const to = ease ? new THREE.Vector3(lerp(lo.x, hi.x, hash(p.uid, 103)), lerp(lo.y, hi.y, hash(p.uid, 107)), lerp(lo.z, hi.z, hash(p.uid, 109))) : lo.clone().lerp(hi, hash(p.uid, 103));
      let t = saturate(remap(p.nage, st, et)); if (ease) t = t * t * (3 - 2 * t); p.setV(out, p.initV(out).clone().lerp(to, t)); } };
  },
  // Squared distance against squared bounds. Particles go in groups of four (the engine's SIMD lanes):
  // a group none of which is in the active range is left alone. Line of sight is never blocked here.
  C_OP_DistanceToTransform(d) {
    const out = field(d.m_nFieldOutput, F.Radius), i0 = number(d.m_flInputMin), i1 = number(d.m_flInputMax, 128), o0 = number(d.m_flOutputMin), o1 = number(d.m_flOutputMax, 1), tr = transform(d.m_TransformStart, 0);
    const method = d.m_nSetMethod, active = d.m_bActiveRange, add = d.m_bAdditive, scale = vector(d.m_vecComponentScale, [1, 1, 1]);
    return (ps, dt, s, str) => {
      const c = translation(tr(s));
      for (let h = 0; h < ps.length; h += 4) {
        const lanes = ps.slice(h, h + 4), pass = [], vals = lanes.map((p) => {
          const a = i0(p, s) ** 2, b = i1(p, s) ** 2, d2 = p.pos.clone().sub(c).multiply(scale(p, s)).lengthSq(), [lo, hi] = outputs(out, o0(p, s), o1(p, s));
          pass.push(!active || (d2 <= b && a <= d2)); return lerp(lo, hi, saturate((d2 - a) / (b === a ? 1 : b - a)));
        });
        if (!pass.some(Boolean)) continue;
        lanes.forEach((p, i) => { const cur = p.getS(out), delta = (setMethod(p, out, vals[i], method, dt) - cur) * (pass[i] ? str : 0); p.setS(out, add ? cur + (cur + delta) : cur + delta); });
      }
    };
  },
  C_OP_RemapScalar(d) {
    const fin = field(d.m_nFieldInput, F.Alpha), out = field(d.m_nFieldOutput, F.Radius), i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, [o0, o1] = outputs(out, d.m_flOutputMin ?? 0, d.m_flOutputMax ?? 1), old = d.m_bOldCode;
    // The current code clamps the input into the range, the old one the ratio (they differ for an inverted range).
    return (ps, dt, s, str) => { const k = Math.min(str, 1); for (const p of ps) { const x = p.getS(fin);
      const v = i0 === i1 ? (x >= i1 ? o1 : o0) : old ? remapClamped(x, i0, i1, o0, o1) : o0 + (o1 - o0) * (Math.max(i0, Math.min(i1, x)) - i0) / (i1 - i0); p.setS(out, lerp(p.getS(out), v, k)); } };
  },
  // The system plays again (emitters from their start) after a random time, scaled by a control
  // point's component; or only its children of a group do, every such time.
  C_OP_RestartAfterDuration(d) {
    const a = d.m_flDurationMin ?? 0, b = d.m_flDurationMax ?? 1, cp = d.m_nCP ?? -1, f = d.m_nCPField ?? 0, group = d.m_nChildGroupID ?? 0, children = d.m_bOnlyChildren; let interval = -1, from = 0;
    const scaled = (t, s) => (cp < 0 || f < 0 ? t : t * s.cp(cp).pos.getComponent(Math.min(2, f)));
    return (ps, dt, s) => {
      if (s.restartAt !== undefined) return;
      if (!children) { s.restartAt = s.age + scaled(lerp(a, b, rnd()), s); return; }
      if (interval < 0) { interval = lerp(a, b, rnd()); from = s.age; }
      if (s.age <= from + scaled(interval, s)) return;
      for (const c of s.sim.children) if (c.groupId === group) c.state.restartAt = c.state.age;
      from = s.age; interval = lerp(a, b, rnd());
    };
  },
  // Entering the end cap the current values become the initial ones, then go to m_vecOutput; once there it stops writing.
  C_OP_LerpEndCapVector(d) {
    const out = field(d.m_nFieldOutput, F.Position), to = vec(d.m_vecOutput), time = d.m_flLerpTime ?? 1; let start = -1;
    return (ps, dt, s, str) => {
      if (s.endedAt === undefined) return; if (start < 0) { start = s.age; for (const p of ps) p.initial?.setV(out, p.getV(out)); }
      const t = (s.age - start) / (time + EPSILON); if (t > 1) return; for (const p of ps) p.setV(out, p.initV(out).clone().lerp(to, t * str));
    };
  },
  // Kills particles behind a plane through a control point (pushed back along its normal by m_flPlaneOffset).
  C_OP_PlaneCull(d) {
    const cp = d.m_nPlaneControlPoint ?? 0, dir = vector(d.m_vecPlaneDirection, [0, 0, 1]), off = d.m_flPlaneOffset ?? 0, local = d.m_bLocalSpace;
    return (ps, dt, s) => { const n = dir(null, s).clone(); if (n.lengthSq() === 0) return; if (local) n.applyQuaternion(s.cp(cp).quat); n.normalize(); const o = s.cp(cp).pos.clone().addScaledVector(n, -off);
      for (const p of ps) if (n.dot(p.pos.clone().sub(o)) < 0) p.dead = true; };
  },
  // The particle's index among the living, remapped (m_bActiveRange: only those in the input range).
  C_OP_RemapParticleCountToScalar(d) {
    const i0 = number(d.m_nInputMin), i1 = number(d.m_nInputMax, 1), o0 = number(d.m_flOutputMin), o1 = number(d.m_flOutputMax, 1), out = field(d.m_nFieldOutput, F.Radius), method = d.m_nSetMethod, active = d.m_bActiveRange;
    return (ps, dt, s, str) => { const a = Math.trunc(i0(null, s)), b = Math.trunc(i1(null, s)), [lo, hi] = outputs(out, o0(null, s), o1(null, s));
      for (const p of ps) { if (active && (p.index < a || p.index >= b)) continue; p.setS(out, lerp(p.getS(out), setMethod(p, out, remapClamped(p.index, a, b, lo, hi), method, dt), str)); } };
  },
  C_OP_PercentageBetweenTransforms(d) {
    const out = field(d.m_nFieldOutput, F.Radius), i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, [o0, o1] = outputs(out, d.m_flOutputMin ?? 0, d.m_flOutputMax ?? 1), ta = transform(d.m_TransformStart, 0), tb = transform(d.m_TransformEnd, 0);
    const method = d.m_nSetMethod, active = d.m_bActiveRange, radial = d.m_bRadialCheck !== false;
    return (ps, dt, s) => { const a = translation(ta(s)), b = translation(tb(s));
      for (const p of ps) { const x = percentage(p.pos, a, b, radial); if (active && !(i0 <= x && x <= i1)) continue; p.setS(out, setMethod(p, out, lerp(o0, o1, saturate((x - i0) / (i1 === i0 ? 1 : i1 - i0))), method, dt)); } };
  },
  C_OP_PercentageBetweenTransformsVector(d) {
    const out = field(d.m_nFieldOutput, F.Color), i0 = d.m_flInputMin ?? 0, i1 = d.m_flInputMax ?? 1, o0 = vec(d.m_vecOutputMin), o1 = vec(d.m_vecOutputMax, [1, 1, 1]), ta = transform(d.m_TransformStart, 0), tb = transform(d.m_TransformEnd, 0);
    const method = d.m_nSetMethod, active = d.m_bActiveRange, radial = d.m_bRadialCheck !== false;
    return (ps, dt, s) => { const a = translation(ta(s)), b = translation(tb(s));
      for (const p of ps) { const x = percentage(p.pos, a, b, radial); if (active && !(i0 <= x && x <= i1)) continue; p.setV(out, setVMethod(p, out, o0.clone().lerp(o1, saturate((x - i0) / (i1 === i0 ? 1 : i1 - i0))), method, dt)); } };
  },
  // Strength scales the result, but not a comparison's 0 or 1.
  C_OP_SetAttributeToScalarExpression(d) {
    const a = number(d.m_flInput1, 1), b = number(d.m_flInput2, 0), out = field(d.m_nOutputField, F.Radius), method = d.m_nSetMethod, e = String(d.m_nExpression ?? 'SCALAR_EXPRESSION_ADD').replace('SCALAR_EXPRESSION_', '');
    const fn = { ADD: (x, y) => x + y, SUBTRACT: (x, y) => x - y, MUL: (x, y) => x * y, DIVIDE: (x, y) => (y === 0 ? 0 : x / y), INPUT_1: (x) => x, MIN: Math.min, MAX: Math.max, MOD: (x, y) => x % y,
      EQUAL: (x, y) => (x === y ? 1 : 0), GT: (x, y) => (x > y ? 1 : 0), LT: (x, y) => (x < y ? 1 : 0) }[e] || (() => 0), cmp = ['EQUAL', 'GT', 'LT'].includes(e);
    return (ps, dt, s, str) => { for (const p of ps) { const v = fn(a(p, s), b(p, s)); p.setS(out, setMethod(p, out, cmp ? v : v * str, method, dt)); } };
  },
  // Line of sight (m_bLOS) would need world traces: never blocked here.
  C_OP_DistanceBetweenTransforms(d) {
    const out = field(d.m_nFieldOutput, F.Radius), i0 = number(d.m_flInputMin), i1 = number(d.m_flInputMax, 128), o0 = number(d.m_flOutputMin), o1 = number(d.m_flOutputMax, 1), ta = transform(d.m_TransformStart, 0), tb = transform(d.m_TransformEnd, 0), method = d.m_nSetMethod;
    return (ps, dt, s, str) => { const dist = translation(ta(s)).distanceTo(translation(tb(s)));
      for (const p of ps) { const a = i0(p, s), b = i1(p, s), v = lerp(o0(p, s), o1(p, s), saturate((dist - a) / (b === a ? 1 : b - a))); p.setS(out, lerp(p.getS(out), setMethod(p, out, v, method, dt), str)); } };
  },
  // Fields of different kinds (a vector and a float): nothing.
  C_OP_LerpToOtherAttribute(d) {
    const fin = field(d.m_nFieldInput, F.Position), out = field(d.m_nFieldOutput, F.Position), k = number(d.m_flInterpolation, 1), v = VECTOR.has(fin); if (v !== VECTOR.has(out)) return null;
    return (ps, dt, s, str) => { for (const p of ps) { const t = saturate(k(p, s) * str); if (v) p.setV(out, p.getV(out).clone().lerp(p.getV(fin), t)); else p.setS(out, lerp(p.getS(out), p.getS(fin), t)); } };
  },
  // Once, entering the end cap: a random value.
  C_OP_ReinitializeScalarEndCap(d) {
    const out = field(d.m_nFieldOutput, F.Radius), [lo, hi] = outputs(out, d.m_flOutputMin ?? 0, d.m_flOutputMax ?? 1); let done = false;
    return (ps, dt, s, str) => { if (done || s.endedAt === undefined) return; done = true; for (const p of ps) p.setS(out, lerp(p.getS(out), lerp(lo, hi, rnd()), str)); };
  },
  // Once, entering the end cap: the particles' indices remapped (counted from the newest with m_bBackwards).
  C_OP_RemapParticleCountOnScalarEndCap(d) {
    const out = field(d.m_nFieldOutput, F.Radius), i0 = d.m_nInputMin ?? 0, i1 = d.m_nInputMax ?? 1, [o0, o1] = outputs(out, d.m_flOutputMin ?? 0, d.m_flOutputMax ?? 1), back = d.m_bBackwards, method = d.m_nSetMethod; let done = false;
    return (ps, dt, s, str) => {
      if (done || s.endedAt === undefined) return; done = true; const n = ps.length, a = Math.min(n, Math.max(0, back ? n - i1 - 1 : i0)), b = Math.min(n, Math.max(0, back ? n - i0 : i1));
      for (let i = a; i < b; i++) { const p = ps[i]; p.setS(out, lerp(p.getS(out), setMethod(p, out, remapClamped(i, a, back ? b - 1 : b, back ? o1 : o0, back ? o0 : o1), method, dt), str)); }
    };
  },
  // The set method applies to the target; the lerp runs from the initial value for the initial-value methods only.
  C_OP_LerpVector(d) {
    const out = field(d.m_nFieldOutput, F.Position), to = vec(d.m_vecOutput), st = d.m_flStartTime ?? 0, et = d.m_flEndTime ?? 1, method = d.m_nSetMethod, fromInitial = /INITIAL/.test(method || '');
    return (ps, dt, s, str) => { for (const p of ps) { const target = setVMethod(p, out, to, method, dt); p.setV(out, (fromInitial ? p.initV(out) : p.getV(out)).clone().lerp(target, saturate(remap(p.nage, st, et)) * str)); } };
  },
});

const EMIT = {
  // Keeps the system at a number of particles: what died is made again (at a rate, if one is given).
  C_OP_MaintainEmitter(d) {
    const count = number(d.m_nParticlesToMaintain, 100), start = number(d.m_flStartTime), rate = number(d.m_flEmissionRate, 0); let pending = 0;
    return { reset() { pending = 0; }, emit(dt, s, emit) {
      if (s.age < start(null, s)) return; let k = Math.min(Math.floor(count(null, s)), s.max) - s.sim.particles.length; if (k <= 0) return;
      const r = rate(null, s); if (r > 0) { pending += r * dt; const n = Math.floor(pending); pending -= n; k = Math.min(k, n); }
      for (let i = 0; i < k; i++) emit(0); } };
  },
  C_OP_ContinuousEmitter(d) {
    const dur = number(d.m_flEmissionDuration), start = number(d.m_flStartTime), rate = number(d.m_flEmitRate, 100); let pending = 0, flushed = 0, finished = false;
    return { reset() { pending = 0; flushed = 0; finished = false; }, emit(dt, s, emit) {
      if (finished) return; const end = s.age - s.start, st = start(null, s), du = dur(null, s); let a = end - dt, b = end; if (st > b) return; if (du) { a = Math.max(st, a); b = Math.min(st + du, b); }
      if (b > a) { pending += Math.max(0, rate(null, s)) * (b - a); const to = Math.floor(pending + 0.001), n = to - flushed; if (n > 0) { flushed = to; const step = (b - a) / n; for (let i = 0; i < n; i++) emit(end - Math.min(a + (i + 1) * step, b)); } }
      if (du && end > st + du) finished = true; } };
  },
  C_OP_InstantaneousEmitter(d) {
    const count = number(d.m_nParticlesToEmit, 100), start = number(d.m_flStartTime), snapCP = d.m_nSnapshotControlPoint ?? -1; let done = false;
    return { reset() { done = false; }, emit(dt, s, emit) { if (done) return; const st = start(null, s), t = s.age - s.start; if (t < st) return; done = true;
      let n = snapCP >= 0 && s.snapshot(snapCP) ? s.snapshot(snapCP).count : Math.floor(count(null, s)); n = Math.min(n, s.max); for (let i = 0; i < n; i++) emit(t - st); } };
  },
  C_OP_NoiseEmitter(d) {
    const dur = number(d.m_flEmissionDuration), start = number(d.m_flStartTime), ns = number(d.m_flNoiseScale, 0.1), o0 = number(d.m_flOutputMin), o1 = number(d.m_flOutputMax, 100), off = d.m_flOffset ?? 0;
    let pending = 1, flushed = 0, finished = false;
    return { reset() { pending = 1; flushed = 0; finished = false; }, emit(dt, s, emit) {
      if (finished) return; const end = s.age - s.start, st = start(null, s), du = dur(null, s); let a = end - dt, b = end; if (st > b) return; if (du) { a = Math.max(st, a); b = Math.min(st + du, b); }
      if (b > a) { const t = (end + off) * ns(null, s), n = noise3(t, t, t), lo = o0(null, s), hi = o1(null, s), r = Math.max(0, lo + 0.5 * (hi - lo) + 0.5 * (hi - lo) * n);
        pending += r * (b - a); const to = Math.floor(pending), k = to - flushed; if (k > 0) { flushed = to; const step = (b - a) / k; for (let i = 0; i < k; i++) emit(end - Math.min(a + (i + 1) * step, b)); } }
      if (du && end > st + du) finished = true; } };
  },
};

// ---------------------------------------------------------------- control points and systems
class ControlPoint {
  constructor() { this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); }
  matrix() { return new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1)); }
}
class State {
  constructor(sim, parent) { this.sim = sim; this.parent = parent; this.own = new Map(); this.age = 0; this.start = 0; this.prevDt = 0; this.seed = Math.floor(rnd() * 1e6); }
  get max() { return this.sim.maxParticles; }
  get model() { return this.sim.root.model; }
  cp(i) { return this.own.get(i) || (this.parent ? this.parent.cp(i) : this.sim.root.cps.get(i) || this.sim.root.cps.get(0) || new ControlPoint()); }
  setCP(i, pos) { const c = this.own.get(i) || new ControlPoint(); c.pos.copy(pos); this.own.set(i, c); }
  setCPRotation(i, q) { const c = this.own.get(i) || Object.assign(new ControlPoint(), { pos: this.cp(i).pos.clone() }); c.quat.copy(q); this.own.set(i, c); }
  override(i, pos, quat, byParent = false) { const c = this.own.get(i) || new ControlPoint(); c.pos.copy(pos); if (quat) c.quat.copy(quat); this.own.set(i, c); if (byParent && quat) (this.parentTurns ||= new Set()).add(i); }
  // The snapshot on a control point: a parent's on it goes before the system's own (Scythes of
  // Sorrow's right edge puts edge_r on CP 6 over its child's edge_l, the left one), then any.
  snapshot(cp) { return this.parent?.snapshotOn(cp) || this.snapshotOn(cp) || this.sim.snapshot || this.parent?.snapshot(cp) || null; }
  snapshotOn(cp) { return this.parent?.snapshotOn(cp) || (this.sim.snapshot && this.sim.snapshotCP === cp ? this.sim.snapshot : null); }
}

export class Simulation {
  constructor(def, lib, root = null, parentState = null) {
    this.def = def; this.lib = lib; this.root = root || this; this.children = []; this.particles = []; this.emitted = 0;
    if (!root) { this.cps = new Map(); this.model = null; }
    this.state = new State(this, parentState);
    this.maxParticles = Math.min(Number.isFinite(def.m_nMaxParticles)&&def.m_nMaxParticles>0?def.m_nMaxParticles:1000, 2000);
    const cc = def.m_ConstantColor || [255, 255, 255, 255];
    this.constants = { color: new THREE.Vector3(cc[0] / 255, cc[1] / 255, cc[2] / 255), alpha: (cc[3] ?? 255) / 255, radius: def.m_flConstantRadius ?? 5, life: def.m_flConstantLifespan ?? 1,
      roll: (def.m_flConstantRotation ?? 0) * Math.PI / 180, rollSpeed: (def.m_flConstantRotationSpeed ?? 0) * Math.PI / 180, seq: def.m_nConstantSequenceNumber ?? 0 };
    this.maxStep = def.m_flMaximumTimeStep ?? 0.1;
    this.preSim = def.m_flPreSimulationTime ?? 0;
    this.groupId = def.m_nGroupID ?? 0;
    const build = (list, table) => (list || []).filter((d) => !d.m_bDisableOperator).map((d) => { const f = table[d._class]; if (!f) { lib.unsupported.add(d._class); return null; } const fn = f(d); return fn ? { fn, strength: strength(d), endcap: endcapState(d) } : null; }).filter(Boolean);
    this.pre = build(def.m_PreEmissionOperators, OP);
    this.emitters = build(def.m_Emitters, EMIT);
    // Initializers keep their definition index and the fields they write: below behaviour version 6
    // the first writer of a field wins (up to m_nFirstMultipleOverride_BackwardCompat).
    this.version = def.m_nBehaviorVersion ?? 0; this.firstMultiple = def.m_nFirstMultipleOverride_BackwardCompat ?? -1;
    this.inits = (def.m_Initializers || []).map((d, index) => {
      if (d.m_bDisableOperator || endcapSkip(d)) return null; const f = INIT[d._class]; if (!f) { lib.unsupported.add(d._class); return null; }
      const fn = f(d); return fn ? { fn, index, fields: writes(d), strength: d.m_flOpStrength !== undefined ? strength(d) : null } : null;
    }).filter(Boolean);
    // Force generators run from the movement operator. Constraints run after the operators, and again
    // while another one moved particles, up to the movement operator's m_nMaxConstraintPasses rounds.
    this.forces = build(def.m_ForceGenerators, OP);
    this.ops = build(def.m_Operators, OP);
    this.constraints = build(def.m_Constraints, OP);
    this.passes = this.constraints.length ? Math.max(1, ...(def.m_Operators || []).filter((o) => o._class === 'C_OP_BasicMovement' && !o.m_bDisableOperator).map((o) => o.m_nMaxConstraintPasses ?? 3)) : 1;
    // A renderer has a strength too: at 0 it draws nothing (Ravenblight's CP 2 picks its feathers' material).
    this.renderers = (def.m_Renderers || []).filter((r) => !r.m_bDisableOperator).map((r) => { const x = lib.renderer(r, this); if (x) x.colorScale = colorScale(r); if (x && r.m_flOpStrength !== undefined) x.strength = strength(r); return x; }).filter(Boolean);
    this.snapshot = def.m_hSnapshot ? lib.snapshot(def.m_hSnapshot) : null; if (this.snapshot) this.snapshot.sim = this; this.snapshotCP = def.m_nSnapshotControlPoint ?? 0;
    for (const c of def.m_Children || []) {
      if (c.m_bEndCap || c.m_bDisableChild) continue;
      const cd = lib.system(c.m_ChildRef); if (!cd) continue;
      const child = new Simulation(cd, lib, this.root, this.state); child.delay = c.m_flDelay ?? 0; this.children.push(child);
    }
    this.delay = 0; this.stopped = false;
  }
  // No more particles from here on (the effect's animation ended): those alive live out their lives,
  // with the operators of the end cap.
  stopEmission() { for (const sim of this.all()) if (!sim.stopped) { sim.stopped = true; sim.state.endedAt = sim.state.age; } }
  get finished() { return this.stopped && this.count() === 0; }
  // Takes this system's meshes out of the scene (an effect that has run its course).
  dispose() { for (const sim of this.all()) for (const r of sim.renderers) r.dispose(); }
  emit(ageAtSpawn) {
    if (this.particles.length >= this.maxParticles) return;
    const p = new Particle(this.constants); p.sys = this.state; p.uid = this.emitted++; p.id = p.uid; p.index = this.particles.length;
    p.pos.copy(this.state.cp(0).pos); p.created = this.state.age - ageAtSpawn; p.age = ageAtSpawn;
    let written = new Set([F.CreationTime]);
    for (const i of this.inits) {
      if (this.version < 6 && (this.firstMultiple < 0 || i.index < this.firstMultiple) && i.fields.length && i.fields.every((f) => written.has(f))) continue;
      // An initializer at strength 0 does nothing (one gated by an item's gem, without a gem).
      if (i.strength && i.strength(this.state) <= 0) continue;
      i.fn(p, this.state); if (p.dead) return; for (const f of i.fields) written.add(f);
    }
    // The previous position one previous step back: movement scales the step by dt / previous dt.
    p.prev.copy(p.pos).addScaledVector(p.vel, -(this.state.prevDt || this.dt || this.maxStep));
    p.initial = p.snapshot();
    this.particles.push(p);
  }
  update(dt, first = true) {
    if (this.delay > 0) { this.delay -= dt; if (this.delay > 0) return; }
    if (first && this.preSim > 0 && !this.preSimDone) { this.preSimDone = true; for (let t = 0; t < this.preSim; t += this.maxStep) this.step(this.maxStep); }
    let left = Math.min(dt, this.maxStep * 10);
    while (left > 1e-6) { const st = Math.min(left, this.maxStep); left -= st; this.step(st); }
    for (const c of this.children) c.update(dt, first);
  }
  step(dt) {
    const s = this.state; this.dt = dt; s.age += dt;
    for (const p of this.particles) p.age = s.age - p.created;
    for (const o of this.pre) { if (!this.runs(o)) continue; const k = o.strength(s); if (k > 0) o.fn(this.particles, dt, s, k); }
    if (!this.stopped) for (const e of this.emitters) if (this.runs(e)) e.fn.emit(dt, s, (age) => this.emit(age));
    for (const o of this.ops) { if (!this.runs(o)) continue; const k = o.strength(s); if (k > 0) o.fn(this.particles, dt, s, k); }
    this.constrain(dt);
    if (this.particles.some((p) => p.dead)) this.particles = this.particles.filter((p) => !p.dead);
    this.particles.forEach((p, i) => { p.index = i; });
    s.prevDt = dt;
    if (s.restartAt !== undefined && s.age > s.restartAt) this.restart();
  }
  runs(o) { return o.endcap === null || o.endcap === this.stopped; }
  constrain(dt) {
    const n = this.constraints.length, done = new Array(n).fill(false);
    for (let pass = 0; pass < this.passes; pass++) {
      let changed = false;
      for (let i = 0; i < n; i++) { if (done[i]) continue; done[i] = true; const o = this.constraints[i]; if (!this.runs(o) || o.strength(this.state) <= 0) continue;
        if (o.fn(this.particles, dt, this.state)) { changed = true; done.fill(false); done[i] = true; } }
      if (!changed) break;
    }
  }
  // C_OP_RestartAfterDuration: the emitters start over, as do the children's; the particles alive live
  // on. A stopped effect stays stopped.
  restart() { const s = this.state; s.restartAt = undefined; if (this.stopped) return; s.start = s.age; for (const e of this.emitters) e.fn.reset(); for (const c of this.children) c.restart(); }
  render(camera, groupInverse) { for (const r of this.renderers) r.update(r.strength && r.strength(this.state) <= 0 ? [] : this.particles, this.state, camera, groupInverse); for (const c of this.children) c.render(camera, groupInverse); }
  *all() { yield this; for (const c of this.children) yield* c.all(); }
  count() { let n = this.particles.length; for (const c of this.children) n += c.count(); return n; }
}

// ---------------------------------------------------------------- rendering
const vertexShader = `
attribute vec4 color; attribute vec4 uvA; attribute vec4 uvB; attribute float blend;
varying vec4 vColor; varying vec2 vUvA; varying vec2 vUvB; varying float vBlend;
void main() { vColor = color; vUvA = mix(uvA.xy, uvA.zw, uv); vUvB = mix(uvB.xy, uvB.zw, uv); vBlend = blend; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = `
uniform sampler2D map; uniform sampler2D alphaMask; uniform bool useAlphaMask; uniform bool alphaFromLuma; uniform bool alphaChannelFromLuma; uniform bool studioSoftDisc; uniform float overbright; uniform float addSelf; uniform bool studioRecolor; uniform bool saturateColor; uniform int mode; uniform bool blendFrames; uniform int channels;
uniform sampler2D tSceneDepth; uniform vec2 uSceneSize; uniform float uNear, uFar, uFeather; uniform bool uSoft;
varying vec4 vColor; varying vec2 vUvA; varying vec2 vUvB; varying float vBlend;
// m_nTextureChannels: which of the texture's channels give the alpha (the game's spritecard; as
// ValveResourceFormat masks a first layer). A glow on black with a solid alpha, read as RGBA_RGBALPHA,
// has its alpha in its brightness: read as RGBA, it drew a square (Primeval Abomination's dark halo,
// a black card behind Primal Beast). Mixes that take no alpha of their own (RGB, the masks, one
// colour channel) keep the texture's: an alpha of 1 there drew the noise trail on the same tail's
// ball as a solid grey strip.
vec4 channelMix(vec4 t) {
  float l = dot(t.rgb, vec3(0.299, 0.587, 0.114));
  if (channels == 2) return vec4(vec3(1.0), alphaChannelFromLuma ? l : t.a);
  if (channels == 6) return vec4(t.rgb, l);
  if (channels == 7 || channels == 8) return vec4(vec3(1.0), l);
  if (channels == 9) return vec4(t.rrr, t.a);
  if (channels == 10) return vec4(t.ggg, t.a);
  if (channels == 11) return vec4(t.bbb, t.a);
  if (channels == 12) return t.rrrr;
  if (channels == 13) return t.gggg;
  if (channels == 14) return t.bbbb;
  return t;
}
float viewDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  vec4 t = texture2D(map, vUvA); if (blendFrames) t = mix(t, texture2D(map, vUvB), vBlend); if (studioRecolor) t.rgb = vec3(max(t.r, max(t.g, t.b))); t = channelMix(t);
  vec3 c = vColor.rgb * t.rgb; float a = t.a * vColor.a;
  // The alpha-cloud resources use grayscale coverage even with opaque PNG alpha.
  // Explicit mask layers must be combined with the colour layer, not displayed
  // as their own opaque sprite quads.
  if (alphaFromLuma) a = min(a, dot(t.rgb, vec3(0.299, 0.587, 0.114)) * vColor.a);
  if (useAlphaMask) {
    vec4 maskSample = texture2D(alphaMask, vUvA);
    a *= min(maskSample.a, dot(maskSample.rgb, vec3(0.299, 0.587, 0.114)));
  }
  // Cosmic weapon: the native sprite uses caustic UV zoom / distortion for its
  // falloff. Without that stage the texture is a flat bright disk; approximate
  // the missing coverage in the preview only (other sprites unaffected).
  if (studioSoftDisc) a *= 1.0 - smoothstep(0.20, 0.50, length(vUvA - vec2(0.5)));
  // Depth feathering: the card fades where it meets what lies behind it (a glow on an item lights its
  // outline and leaves the item seen through it, as in the game).
  if (uSoft && uFeather > 0.0) a *= clamp((viewDepth(texture2D(tSceneDepth, gl_FragCoord.xy / uSceneSize).x) - viewDepth(gl_FragCoord.z)) / uFeather, 0.0, 1.0);
  if (mode == 5) { vec3 m = mix(vec3(0.5), mix(vec3(0.5), c, vColor.rgb), vec3(a)); gl_FragColor = vec4(clamp(m, 0.0, 1.0), a); return; }
  c *= overbright; if (saturateColor) c = clamp(c, 0.0, 1.0); c *= addSelf;
  gl_FragColor = vec4(c * a, mode == 1 ? 0.0 : a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// The scene's depth without the effects, for depth feathering: the viewer renders it each frame and
// sets these (shared by every particle material); off, nothing fades.
export const SOFT = { tSceneDepth: { value: null }, uSceneSize: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 100 }, uSoft: { value: false } };
// How near (game units) a feathered card fades out where nothing is set (the usual authored distance).
const FEATHER = 6;
const CHANNELS = ['RGB', 'RGBA', 'A', 'RGB_A', 'RGB_ALPHAMASK', 'RGB_RGBMASK', 'RGBA_RGBALPHA', 'A_RGBALPHA', 'RGB_A_RGBALPHA', 'R', 'G', 'B', 'RALPHA', 'GALPHA', 'BALPHA'].map((c) => `SPRITECARD_TEXTURE_CHANNEL_MIX_${c}`);
function material(texInfo, r) {
  const tex = texInfo.texture;
  const mode = r.m_nOutputBlendMode === 'PARTICLE_OUTPUT_BLEND_MODE_ADD' ? 1 : r.m_nOutputBlendMode === 'PARTICLE_OUTPUT_BLEND_MODE_MOD2X' ? 5 : 0;
  const feather = /ON_/.test(r.m_nFeatheringMode || '') ? number(r.m_flFeatheringMaxDist, FEATHER)(null, null) * 0.0254 : 0;
  const m = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { studioRecolor: { value: r.m_bStudioRecolor === true }, map: { value: tex }, alphaMask: { value: texInfo.maskTexture || tex }, useAlphaMask: { value: !!texInfo.maskTexture }, alphaFromLuma: { value: !!texInfo.alphaFromLuma }, alphaChannelFromLuma: { value: !!texInfo.alphaChannelFromLuma }, studioSoftDisc: { value: r.studioSoftDisc === true }, overbright: { value: number(r.m_flOverbrightFactor, 1)(null, null) }, addSelf: { value: 1 + number(r.m_flAddSelfAmount, 0)(null, null) },
      saturateColor: { value: r.m_bSaturateColorPreAlphaBlend !== false }, mode: { value: mode }, blendFrames: { value: r.m_bBlendFramesSeq0 !== false }, ...SOFT, uFeather: { value: feather },
      channels: { value: CHANNELS.indexOf(texInfo.channel ?? 'SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA') } },
  });
  // Mod2x: colour = 2 × source × destination, so 50 % grey changes nothing. The canvas's alpha must
  // stay as it is: blended like the colour, it fell to 2 × a × alpha, and the sprite's whole square
  // cut a see-through hole in the hero, invisible on a dark background, a pale square on a light one.
  if (mode === 5) Object.assign(m, { blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation });
  else Object.assign(m, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation, premultipliedAlpha: true });
  return m;
}
const lin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
class QuadBatch {
  constructor(group, texInfo, r, capacity) {
    // Colours are authored in gamma space and made linear unless the renderer says otherwise; mod2x
    // keeps them as they are, since its neutral is 0.5 (see texture()).
    this.linear = r.m_bGammaCorrectVertexColors !== false && r.m_nOutputBlendMode !== 'PARTICLE_OUTPUT_BLEND_MODE_MOD2X';
    this.capacity = capacity; const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 12); this.uv = new Float32Array(capacity * 8); this.col = new Float32Array(capacity * 16); this.ua = new Float32Array(capacity * 16); this.ub = new Float32Array(capacity * 16); this.bl = new Float32Array(capacity * 4);
    const idx = new Uint32Array(capacity * 6); for (let i = 0; i < capacity; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    for (const [n, a, k] of [['position', this.pos, 3], ['uv', this.uv, 2], ['color', this.col, 4], ['uvA', this.ua, 4], ['uvB', this.ub, 4], ['blend', this.bl, 1]]) g.setAttribute(n, new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage));
    for (let i = 0; i < capacity; i++) this.uv.set([0, 1, 0, 0, 1, 0, 1, 1], i * 8);
    g.setDrawRange(0, 0); // nothing until the first frame fills it (not the whole empty buffer)
    this.mesh = new THREE.Mesh(g, material(texInfo, r)); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; group.add(this.mesh); this.n = 0;
  }
  begin() { this.n = 0; }
  quad(corners, color, uvA, uvB, blend) {
    if (this.n >= this.capacity) return;
    // A card with any value that is not a number would be drawn as a solid square (or not at all,
    // depending on the GPU): it is skipped.
    if (!Number.isFinite(blend) || !corners.every((c) => Number.isFinite(c.x + c.y + c.z)) || !(Array.isArray(color[0]) ? color.flat() : color).every(Number.isFinite) || !uvA.every(Number.isFinite) || !uvB.every(Number.isFinite)) return;
    const i = this.n++;
    for (let k = 0; k < 4; k++) { this.pos.set([corners[k].x, corners[k].y, corners[k].z], i * 12 + k * 3); const c = Array.isArray(color[0]) ? color[k] : color; this.col.set(this.linear ? [lin(c[0]), lin(c[1]), lin(c[2]), c[3]] : c, i * 16 + k * 4); this.ua.set(uvA, i * 16 + k * 4); this.ub.set(uvB, i * 16 + k * 4); this.bl[i * 4 + k] = blend; }
  }
  end() { const g = this.mesh.geometry; g.setDrawRange(0, this.n * 6); for (const k of ['position', 'color', 'uvA', 'uvB', 'blend']) g.attributes[k].needsUpdate = true; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
function sheetFrame(info, p, rate, type) {
  const seqs = info?.sequences; if (!seqs?.length) return null;
  const seq = seqs[p.seq % seqs.length]; if (!seq?.frames.length) return null;
  if (seq.frames.length < 2) return { a: seq.frames[0].uv, b: seq.frames[0].uv, fa: seq.frames[0], fb: seq.frames[0], t: 0 };
  const total = seq.frames.reduce((a, f) => a + f.time, 0) || seq.frames.length;
  const passes = (type === 'ANIMATION_TYPE_FIT_LIFETIME' ? p.nage : p.age) * rate;
  // A sheet's last frame may last 0 (caustic.vtex): its blend toward the next is 0, not 0 / 0. A NaN
  // here reached the shader and drew the whole card white.
  let pos = total * (seq.clamp ? saturate(passes) : passes - Math.floor(passes)); if (!Number.isFinite(pos)) pos = 0;
  for (let i = 0; i < seq.frames.length; i++) { const f = seq.frames[i]; if (pos < f.time || i === seq.frames.length - 1) { const n = seq.clamp ? Math.min(i + 1, seq.frames.length - 1) : (i + 1) % seq.frames.length; return { a: f.uv, b: seq.frames[n].uv, fa: f, fb: seq.frames[n], t: f.time > 0 ? saturate(pos / f.time) : 0 }; } pos -= f.time; }
  return null;
}
// A sprite's texture when it names none, and in place of one the game lacks (a broader glow).
const GLOW = 'materials/particle/particle_glow_05.vtex', SOFT_GLOW = 'materials/particle/particle_glow_01.vtex', SMOKE = 'materials/particle/smoke1/smoke1.vtex';
// What stands in for a texture the game lacks: smoke for smoke (a glow would be a solid cloud), else a glow.
const standIn = (path) => (/smoke/.test(path) ? SMOKE : SOFT_GLOW);
const FULL = [0, 0, 1, 1], Z = new THREE.Vector3(0, 0, 1);
// Screen-facing basis in the particle space, from the camera.
function billboard(camera, groupInverse) {
  const m = new THREE.Matrix3().setFromMatrix4(groupInverse.clone().multiply(camera.matrixWorld));
  const right = new THREE.Vector3(1, 0, 0).applyMatrix3(m).normalize(), up = new THREE.Vector3(0, 1, 0).applyMatrix3(m).normalize();
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).applyMatrix4(groupInverse);
  return { right, up, eye };
}
// m_vecColorScale: a renderer's own tint over its particles' colour (Featherfall's white rim drawn
// red, its smoke pink, its shadow dark grey). Without one, the colour as it is.
const colorScale = (r) => { if (!r.m_vecColorScale) return null; const v = vector(r.m_vecColorScale, [1, 1, 1]); return (p, s) => v(p, s); };
const scaled = (k, p, s) => { const c = p.color; if (!k) return [c.x, c.y, c.z]; const m = k(p, s); return [c.x * m.x, c.y * m.y, c.z * m.z]; };
// The engine's blob shader is approximated with a fused metaball surface.
class BlobRenderer {
 constructor(r,lib,sim){this.r=r;this.lib=lib;const native=lib.materials?.[r.m_hMaterial],appearance=blobAppearance(r.m_hMaterial,native);this.material=new THREE.MeshPhysicalMaterial({color:new THREE.Color().setRGB(...appearance.tint.slice(0,3)),vertexColors:true,roughness:appearance.roughness,metalness:appearance.metalness,clearcoat:appearance.clearcoat,transparent:true,opacity:appearance.opacity,side:THREE.DoubleSide});const normal=native?.textures?.g_tNormal;if(normal&&lib.textures?.[normal])this.material.normalMap=lib.texture({m_hTexture:normal}).texture;this.surface=new MarchingCubes(28,this.material,false,true,16000);this.surface.frustumCulled=false;lib.group.add(this.surface);lib.unsupported.add('C_OP_RenderBlobs: approximate metaball surface');}
 update(ps,s){this.surface.reset();const live=ps.filter(p=>p.alpha>1/255);this.surface.visible=!!live.length;if(!live.length)return;const box=new THREE.Box3();for(const p of live)box.expandByPoint(p.pos);const radius=Math.max(this.r.m_cutoffRadius??13,...live.map(p=>p.radius)),center=box.getCenter(new THREE.Vector3()),extent=Math.max(32,box.getSize(new THREE.Vector3()).length()+radius*4);this.surface.position.copy(center);this.surface.scale.setScalar(extent/2);for(const p of live.slice(0,256)){const point=p.pos.clone().sub(center).divideScalar(extent).addScalar(.5),r=Math.max(this.r.m_renderRadius??4,p.radius*.5)/extent,c=scaled(this.colorScale,p,s);this.surface.addBall(point.x,point.y,point.z,r*r*92,12,new THREE.Color().setRGB(...c));}this.material.opacity=Math.min(1,Math.max(...live.map(p=>p.alpha)));this.surface.update();}
 dispose(){this.lib.group.remove(this.surface);this.surface.geometry.dispose();this.material.dispose();}
}
class SpriteRenderer {
  dispose() { this.batch.dispose(); }
  constructor(r, lib, sim) {
    const t = lib.texture(r); this.info = t.info; this.batch = new QuadBatch(lib.group, t, r, sim.maxParticles); this.rate = r.m_flAnimationRate ?? 0.1; this.type = r.m_nAnimationType;
    this.orient = r.m_nOrientationType; this.radiusScale = number(r.m_flRadiusScale, 1); this.alphaScale = number(r.m_flAlphaScale, 1);
    this.minSize = number(r.m_flMinSize, 0)(); this.maxSize = number(r.m_flMaxSize, 5000)(); this.fadeStart = number(r.m_flStartFadeSize, 1e8)(); this.fadeEnd = number(r.m_flEndFadeSize, 2e8)();
    // Cards lying in a plane fade as they turn edge-on to the eye: full where the dot of their normal
    // and the way to the eye is the start one, gone at the end one (the defaults, 1 and 2, never fade).
    this.dotStart = r.m_flStartFadeDot ?? 1; this.dotEnd = r.m_flEndFadeDot ?? 2;
  }
  update(ps, s, camera, gi) {
    const b = this.batch, { right, up, eye } = billboard(camera, gi); b.begin();
    for (const p of ps) {
      // Screen-size limits: a card that grows too large on screen fades, and its size is clamped.
      const dist = eye.distanceTo(p.pos); let r = p.radius * this.radiusScale(p, s), fade = 1;
      if (r > this.fadeStart * dist) { if (r >= this.fadeEnd * dist) continue; fade = 1 - remap(r, this.fadeStart * dist, this.fadeEnd * dist); }
      r = Math.min(Math.max(r, this.minSize * dist), this.maxSize * dist);
      const flat = this.orient === 'PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL' ? p.normal : this.orient === 'PARTICLE_ORIENTATION_WORLD_Z_ALIGNED' ? Z : null;
      if (flat && this.dotEnd < this.dotStart) { const d = Math.abs(flat.clone().normalize().dot(eye.clone().sub(p.pos).normalize())); fade *= saturate((d - this.dotEnd) / (this.dotStart - this.dotEnd)); }
      const a = p.alpha * this.alphaScale(p, s) * fade; if (r <= 0 || a < 1 / 255) continue;
      let R, U;
      if (this.orient === 'PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL') { const n = p.normal.clone().normalize(), ref = Math.abs(n.z) > 0.1 ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1); U = n.clone().cross(ref).normalize(); R = U.clone().cross(n); }
      else if (this.orient === 'PARTICLE_ORIENTATION_WORLD_Z_ALIGNED') { R = new THREE.Vector3(0, -1, 0); U = new THREE.Vector3(1, 0, 0); }
      else { R = right.clone(); U = up.clone(); }
      const c = Math.cos(p.rot.z), sn = Math.sin(p.rot.z), rr = R.clone().multiplyScalar(c).addScaledVector(U, sn).multiplyScalar(r), uu = U.clone().multiplyScalar(c).addScaledVector(R, -sn).multiplyScalar(r);
      // Sheet frames are cropped to their content: the card shrinks to the crop window, as in the game.
      const o = p.pos.clone(), f = sheetFrame(this.info, p, this.rate, this.type);
      let uvA = FULL, uvB = FULL;
      if (f) {
        const win = (fr) => { const [u0, v0, u1, v1] = fr.uv, [c0, d0, c1, d1] = fr.crop || fr.uv, w = u1 - u0 || 1, h = v1 - v0 || 1; return [(c0 - u0) / w, (d0 - v0) / h, (c1 - u0) / w, (d1 - v0) / h]; };
        const A = win(f.fa), B = win(f.fb), W = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
        const rect = (fr) => { const [u0, v0, u1, v1] = fr.uv; return [u0 + W[0] * (u1 - u0), v0 + W[1] * (v1 - v0), u0 + W[2] * (u1 - u0), v0 + W[3] * (v1 - v0)]; };
        o.addScaledVector(rr, W[2] + W[0] - 1).addScaledVector(uu, 1 - W[1] - W[3]); rr.multiplyScalar(W[2] - W[0]); uu.multiplyScalar(W[3] - W[1]);
        uvA = rect(f.fa); uvB = rect(f.fb);
      }
      const [cr, cg, cb] = scaled(this.colorScale, p, s);
      b.quad([o.clone().sub(rr).sub(uu), o.clone().sub(rr).add(uu), o.clone().add(rr).add(uu), o.clone().add(rr).sub(uu)], [cr * fade, cg * fade, cb * fade, a], uvA, uvB, f ? f.t : 0);
    }
    b.end();
  }
}
class TrailRenderer {
  dispose() { this.batch.dispose(); }
  constructor(r, lib, sim) {
    const t = lib.texture(r); this.info = t.info; this.batch = new QuadBatch(lib.group, t, r, sim.maxParticles); this.min = r.m_flMinLength ?? 0; this.max = r.m_flMaxLength ?? 2000;
    this.radiusScale = number(r.m_flRadiusScale, 1); this.tail = number(r.m_flTailAlphaScale, 1); this.head = number(r.m_flHeadAlphaScale, 1); this.ignoreDT = r.m_bIgnoreDT;
    this.lengthScale = r.m_flLengthScale ?? 1; this.fadeIn = r.m_flLengthFadeInTime ?? 0; this.ratio = r.m_flConstrainRadiusToLengthRatio ?? 1; this.shift = r.m_flForwardShift ?? 0;
    const tc = r.m_vecTexturesInput?.[0]?.m_TextureControls; this.flipV = tc && number(tc.m_flFinalTextureScaleV, 1)() < 0; this.rate = r.m_flAnimationRate ?? 0.1; this.type = r.m_nAnimationType;
  }
  // RenderTrails: a card from the particle back toward its previous position, as long as the
  // movement times m_flTrailLength (per second unless m_bIgnoreDT), no wider than it is long.
  update(ps, s, camera, gi) {
    const b = this.batch, { eye } = billboard(camera, gi); b.begin(); const oneOverDt = this.ignoreDT || !s.sim.dt ? 1 : 1 / s.sim.dt;
    for (const p of ps) {
      const diff = p.prev.clone().sub(p.pos), dl = diff.length(); if (dl < 1e-6) continue; const dir = diff.divideScalar(dl);
      let len = this.lengthScale * p.trail * dl * oneOverDt; if (this.fadeIn > 0) len *= Math.min(1, p.age / this.fadeIn); len = Math.min(this.max, Math.max(this.min, len)); if (len <= 0) continue;
      const hw = Math.min(p.radius * this.radiusScale(p, s), this.ratio * len), a = p.alpha * p.alpha2; if (hw <= 0 || a < 1 / 255) continue;
      const center = p.pos.clone().addScaledVector(dir, len * (0.5 - this.shift)), V = dir.clone().multiplyScalar(len / 2);
      let U = dir.clone().cross(eye.clone().sub(p.pos)); if (U.lengthSq() < 1e-8) U = dir.clone().cross(new THREE.Vector3(0, 0, 1)); U.normalize().multiplyScalar(hw);
      const f = sheetFrame(this.info, p, this.rate, this.type); let uv = f ? f.a : FULL, uv2 = f ? f.b : FULL;
      if (this.flipV) { uv = [uv[0], uv[3], uv[2], uv[1]]; uv2 = [uv2[0], uv2[3], uv2[2], uv2[1]]; }
      const c = scaled(this.colorScale, p, s), head = [...c, a * this.head(p, s)], tail = [...c, a * this.tail(p, s)];
      // Corners (uv 0,1)(0,0)(1,0)(1,1): V runs from the head (1) to the tail (0), U across.
      b.quad([center.clone().sub(U).sub(V), center.clone().sub(U).add(V), center.clone().add(U).add(V), center.clone().add(U).sub(V)], [head, tail, tail, head], uv, uv2, f ? f.t : 0);
    }
    b.end();
  }
}
class RopeRenderer {
  dispose() { this.batch.dispose(); }
  constructor(r, lib, sim) {
    const t = lib.texture(r); this.batch = new QuadBatch(lib.group, t, r, sim.maxParticles); this.radiusScale = number(r.m_flRadiusScale, 1);
    this.vWorld = r.m_flTextureVWorldSize ?? 10; this.vScroll = r.m_flTextureVScrollRate ?? 0; this.info = t.info;
  }
  update(ps, s, camera, gi) {
    const b = this.batch, { eye } = billboard(camera, gi); b.begin(); if (ps.length < 2) return b.end();
    const pts = [...ps].sort((x, y) => x.uid - y.uid); let v = s.age * this.vScroll / this.vWorld;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], dir = q.pos.clone().sub(p.pos), len = dir.length(); if (len < 1e-4) continue; dir.divideScalar(len);
      const sp = dir.clone().cross(eye.clone().sub(p.pos)).normalize().multiplyScalar(p.radius * this.radiusScale(p, s)), sq = dir.clone().cross(eye.clone().sub(q.pos)).normalize().multiplyScalar(q.radius * this.radiusScale(q, s));
      const v2 = v + len / this.vWorld;
      b.quad([p.pos.clone().sub(sp), q.pos.clone().sub(sq), q.pos.clone().add(sq), p.pos.clone().add(sp)], [...scaled(this.colorScale, p, s), (p.alpha + q.alpha) / 2], [0, v2, 1, v], [0, v2, 1, v], 0);
      v = v2;
    }
    b.end();
  }
}

// C_OP_RenderModels: a model per particle at its position, turned by its orientation (or yaw,
// pitch, roll), scaled by its radius (1 is the model's own size), animated by its age.
const GLTF_TO_SOURCE = SOURCE_TO_GLTF.clone().invert();
class ModelRenderer {
  constructor(r, lib, sim) {
    this.lib = lib; this.list = (r.m_ModelList || []).map((m) => m.m_model).filter(Boolean); this.activity = r.m_ActivityName || null; this.animated = r.m_bAnimated;
    // The material the renderer draws the model in instead of its own (by name, as the build keys them).
    this.override = r.m_hOverrideMaterial ? r.m_hOverrideMaterial.split('/').pop().replace(/\.vmat$/, '') : null;
    this.rate = (r.m_flAnimationRate ?? 30) / 30; this.instances = new Map(); this.free = [];
  }
  update(ps, s) {
    const alive = new Set();
    for (const p of ps) {
      let inst = this.instances.get(p);
      // A model of one gone is taken again before a new one is made (feathers come and go by the hundred).
      if (!inst) { const path = this.list[p.uid % Math.max(1, this.list.length)], i = this.free.findIndex((f) => f.path === path); if (i >= 0) { inst = this.free.splice(i, 1)[0]; inst.scene.visible = true; inst.mixer?.setTime(0); this.instances.set(p, inst); } }
      if (!inst) {
        const path = this.list[p.uid % Math.max(1, this.list.length)], m = this.lib.models.get(path, this.activity, s.sim.def._path, this.override); if (!m) continue;
        const mixer = this.animated && m.clip ? new THREE.AnimationMixer(m.scene) : null; if (mixer) mixer.clipAction(m.clip).play();
        m.scene.matrixAutoUpdate = false; this.lib.group.add(m.scene); inst = { path, scene: m.scene, mixer, materials: m.materials || [] }; this.instances.set(p, inst);
      }
      // The particle's colour tints the model; its alpha fades those that blend (glows, glass).
      const [cr, cg, cb] = scaled(this.colorScale, p, s);
      for (const mat of inst.materials) { mat.userData.studioParticleBaseColor??=mat.color.clone();mat.userData.studioParticleBaseOpacity??=mat.opacity;const base=mat.userData.studioParticleBaseColor;mat.color.setRGB(base.r*cr,base.g*cg,base.b*cb); if (mat.transparent) mat.opacity = mat.userData.studioParticleBaseOpacity*saturate(p.alpha); }
      alive.add(p);
      const q = p.orient || qangle(p.rot.y, p.rot.x, p.rot.z), r = Math.max(1e-4, p.radius);
      inst.scene.matrix.compose(p.pos, q, new THREE.Vector3(r, r, r)).multiply(GLTF_TO_SOURCE); inst.scene.matrixWorldNeedsUpdate = true; inst.scene.visible = p.alpha > 0.01;
      if (inst.mixer) inst.mixer.setTime(p.age * this.rate);
    }
    for (const [p, inst] of this.instances) if (!alive.has(p)) { this.instances.delete(p); inst.scene.visible = false; if (this.free.length < 256) this.free.push(inst); else this.drop(inst); }
  }
  drop(inst) { this.lib.group.remove(inst.scene); for (const m of inst.materials) m.dispose(); }
  dispose() { for (const inst of [...this.instances.values(), ...this.free]) this.drop(inst); this.instances.clear(); this.free = []; }
}

export class Library {
  // systems: { path: definition }; textures: { vtex: { file, sequences } }; url(file) gives a texture's address.
  // models (optional): { get(vmdl) → { scene, clip } } gives the models of C_OP_RenderModels.
  constructor({ systems, textures, snapshots, url, models = null, options = {} }) {
    this.models = models;
    this.options = options; this.systems = systems; this.textures = textures; this.snapshots = snapshots; this.url = url; this.cache = new Map(); this.unsupported = new Set();
    // Snapshots worn items put in place of the hero's (Juggernaut's sword glow along another blade).
    this.aliases = new Map();
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false; this.group.matrix.copy(SOURCE_TO_GLTF); this.loader = new THREE.TextureLoader();
    for (const [path, def] of Object.entries(systems || {})) if (def && !def._path) Object.defineProperty(def, '_path', { value: path });
  }
  system(path) { const k = path.replace(/\.vpcf$/, ''), d = this.systems[k]; return d || null; }
  // An item's systems, textures (their files at full addresses) and snapshots, added to the hero's.
  add({ systems = {}, textures = {}, snapshots = {} }) {
    for (const [path, def] of Object.entries(systems)) { if (this.systems[path]) continue; if (def && !def._path) Object.defineProperty(def, '_path', { value: path }); this.systems[path] = def; }
    for (const [path, info] of Object.entries(textures)) this.textures[path] ||= info;
    for (const [path, data] of Object.entries(snapshots)) this.snapshots[path] ||= data;
  }
  // Colour textures are read as sRGB, except for mod2x: its «modulate» textures are 50 % grey where
  // they leave the picture alone, which as sRGB would be 21 % linear and darken the whole square.
  texture(r) {
    // Without a texture, or with one the game lacks (the seasonal unusual effects' light glow and
    // smoke: their halo round the item), a card is a soft glow; mod2x would darken a square.
    const spec = resolveSpriteTextures(r);
    let path = spec.path;
    // A completely unspecified texture is not license to invent an opaque quad.
    // Keep the legacy default glow only for legacy renderers with no vector inputs.
    if (!path && (!Array.isArray(r.m_vecTexturesInput) || r.m_vecTexturesInput.length === 0)) path = r.m_hTexture || GLOW;
    if (!path) return { texture: null, info: null };
    if (!this.textures[path] && r.m_nOutputBlendMode !== 'PARTICLE_OUTPUT_BLEND_MODE_MOD2X') path = this.textures[standIn(path)] ? standIn(path) : path;
    const raw = r.m_nOutputBlendMode === 'PARTICLE_OUTPUT_BLEND_MODE_MOD2X', key = raw ? `${path}#raw` : path;
    if (!this.cache.has(key)) {
      const info = this.textures[path], t = info ? this.loader.load(this.url(info.file), this.options.onTexture) : null;
      if (t) { t.colorSpace = raw ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      this.cache.set(key, { texture: t, info });
    }
    const result = this.cache.get(key);
    const mask = spec.maskPath && spec.maskPath !== path && this.textures[spec.maskPath]
      ? this.texture({ m_hTexture: spec.maskPath }) : null;
    return { ...result, channel: spec.channel, alphaFromLuma: spec.alphaFromLuma, alphaChannelFromLuma: spec.alphaChannelFromLuma, maskTexture: mask?.texture || null };
  }
  renderer(original, sim) {
    const r = calibrateCosmicFxRenderer(original, sim?.def?._path);
    // A renderer whose texture did not come with the hero would draw bare squares: it is left out.
    if (r._class === 'C_OP_RenderBlobs')return new BlobRenderer(r,this,sim);
    if(r._class==='C_OP_RenderProjected'){const material=this.materials?.[r.m_hProjectedMaterial],path=material?.textures?.g_tColor;if(!path||!this.textures[path]){this.unsupported.add('C_OP_RenderProjected: material unavailable');return null;}this.unsupported.add('C_OP_RenderProjected: approximate ground projection');return new SpriteRenderer({...r,m_hTexture:path,m_nOrientationType:'PARTICLE_ORIENTATION_WORLD_Z_ALIGNED',m_nOutputBlendMode:'PARTICLE_OUTPUT_BLEND_MODE_ADD'},this,sim);}
    if (r._class === 'C_OP_RenderModels') return this.models ? new ModelRenderer(r, this, sim) : null;
    if (!this.texture(r).texture) return null;
    switch (r._class) {
      case 'C_OP_RenderSprites': return r.m_bRefract ? null : new SpriteRenderer(r, this, sim);
      case 'C_OP_RenderTrails': return new TrailRenderer(r, this, sim);
      case 'C_OP_RenderRopes': return new RopeRenderer(r, this, sim);
      case 'C_OP_RenderDeferredLight': return null;
      default: this.unsupported.add(r._class); return null;
    }
  }
  snapshot(path) { const data = this.snapshots[this.aliases.get(path) ?? path]; return data?.position?.length ? new Snapshot(data, null) : null; }
  dispose() { this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); for (const { texture } of this.cache.values()) texture?.dispose(); }
}

// A bone's twin on the other side (RightWeapon0_JNT, LeftWeapon0_JNT), if the name has a side.
const SIDES = [[/Right/, 'Left'], [/Left/, 'Right'], [/right/, 'left'], [/left/, 'right'], [/_R(?=_|\d|$)/, '_L'], [/_L(?=_|\d|$)/, '_R'], [/_r(?=_|\d|$)/, '_l'], [/_l(?=_|\d|$)/, '_r']];
const twin = (name) => { for (const [re, side] of SIDES) if (re.test(name)) return name.replace(re, side); return null; };

// Snapshot points follow the hero: skinned by their bones, or rigid with the snapshot's control point.
class Snapshot {
  constructor(data, sim) { this.rawData = data; this.sim = sim; this.count = data.position?.length || 0; }
  get data() { return this.sim?.root.model?.snapshotData?.(this.rawData) || this.rawData; }
  // A rigid snapshot is fitted to one bone (the builder's); one of a pair (a blade of two) goes on the
  // twin nearer the effect's control point 0: each sword's glow on its own sword.
  boneName() {
    if (this.bone !== undefined) return this.bone;
    const m = this.sim.root.model, name = this.data.bone, other = name && twin(name), a = m?.bone(name), b = other && m?.bone(other);
    if (!a || !b) return (this.bone = name);
    const at = this.sim.state.cp(0).pos;
    return (this.bone = m.bonePosition(b).distanceTo(at) < m.bonePosition(a).distanceTo(at) ? other : name);
  }
  point(i, local) {
    const m = this.sim.root.model, pos = new THREE.Vector3(...this.data.position[i]), skin = this.data.skinning?.[i];
    if (m && skin?.length) return m.skin(pos, skin);
    if (m && this.data.bone) return m.boneLocal(this.boneName(), pos);
    if (local) return pos.applyMatrix4(local);
    return pos.applyMatrix4(this.sim.state.cp(0).matrix());
  }
}
