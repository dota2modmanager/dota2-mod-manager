// Which picture a mod gives, and whether it is worth showing (src/mod-preview.ts makes it, caches
// it and hands it to the window). Pure: path lists and pixels in, answers out, so the two
// judgements this feature rests on are held by tests against real path lists.
//
//   what to show - art that was drawn to be looked at (panorama) beats a model's texture,
//     which is a UV layout and reads as a coloured smear. The two are kept apart as "art" and
//     "texture" so the caller can put the wiki's hero portrait between them;
//   whether it is worth showing at all - a mod that strips a hero's armour ships an *empty*
//     texture. It decodes perfectly and shows nothing, so the decoded pixels are judged
//     before anything is cached.

/** The three kinds of picture a mod can give: drawn art, a model's texture, an animated portrait. */
export type Kind = 'art' | 'texture' | 'video';

/** A decoded picture: 4 bytes a pixel, alpha last, and what the decoder needs to resize it. */
export interface Bitmap { width: number; height: number; data: Buffer | Uint8Array; img?: unknown }

// A mod that replaces a hero's animated portrait carries the best picture of itself there is:
// the author's own showcase of the thing, in motion. Getting a still out of it needs a video
// decoder, and the app is one - Electron carries ffmpeg inside, which is why no copy of it is
// downloaded here. The decoding happens in the window (see renderer/ui/cosmetic-icons.ts);
// src/mod-preview.ts hands over the bytes and keeps the frame that comes back if worthShowing
// below passes it.
const VIDEO_RANKS: [RegExp, number][] = [
  [/^panorama\/videos\/heroes\/[^/]+\.webm$/, 100],
  [/^panorama\/videos\/.+\.webm$/, 80],
];

// Pictures drawn to be looked at, best first. The game draws each of these somewhere in its
// own UI, so whatever the mod put there is what the mod wants shown.
const ART_RANKS: [RegExp, number][] = [
  [/^panorama\/images\/heroes\/selection\/[^/]+\.vtex_c$/, 100], // full-body selection art
  [/^panorama\/images\/heroes\/[^/]+\.vtex_c$/, 95],             // the hero's own portrait
  [/^panorama\/images\/loadingscreens\/[^/]+\.vtex_c$/, 90],
  [/^panorama\/images\/econ\/.+\.vtex_c$/, 85],                  // the item's own icon
  [/^panorama\/images\/heroes\/icons\/[^/]+\.vtex_c$/, 60],
  [/^panorama\/images\/spellicons\/[^/]+\.vtex_c$/, 55],         // small, but real art
  [/^panorama\/images\/.+\.vtex_c$/, 70],
];

/**
 * Which file inside a mod to show, for one of the three kinds.
 * Pure, so the ranking can be held by tests against real path lists.
 * @param paths lowercased inner paths of the mod's VPK
 * @param kind  video is a hero's animated portrait, a .webm
 */
export function pickCandidate(paths: Iterable<string>, kind: Kind): string | null {
  let best: string | null = null;
  let bestRank = 0;
  for (const p of paths) {
    if (kind === 'video' ? !p.endsWith('.webm') : !p.endsWith('.vtex_c')) continue;
    const rank = kind === 'video' ? videoRank(p) : kind === 'art' ? artRank(p) : textureRank(p);
    // ties go to the first one seen, so the same mod always yields the same picture
    if (rank > bestRank) { bestRank = rank; best = p; }
  }
  return best;
}

function videoRank(p: string): number {
  for (const [re, rank] of VIDEO_RANKS) if (re.test(p)) return rank;
  return 0;
}

function artRank(p: string): number {
  for (const [re, rank] of ART_RANKS) if (re.test(p)) return rank;
  return 0;
}

// Maps the renderer reads as numbers rather than looks at: a normal map is flat lavender
// noise, a mask is grey shapes. They sit next to the colour texture under the same name and
// win on tree order if nothing stops them, and then the mod looks like a dud (measured: a
// tree mod offered its normal map first and so ended up with no picture at all).
const DATA_MAP = /_(normal|normals|mask|masks|rough|roughness|metal|metalness|ao|spec|specular|gloss|illum|selfillum|detail|flow|noise|ramp|cubemap|height|disp|trans|fresnel|tint|blend|alpha)[_.]/;

function textureRank(p: string): number {
  if (p.startsWith('panorama/')) return 0; // that is art, and art is asked for separately
  if (DATA_MAP.test(p)) return 0;
  // "default_color" and friends are filler the exporter drops in, not the mod's own look
  if (/(^|\/)(default|dev)\//.test(p)) return 5;
  const colour = /_(color|tcolor|diffuse|albedo)[_.]/.test(p);
  if (p.startsWith('materials/models/')) return colour ? 40 : 20;
  return colour ? 30 : 10;
}

/**
 * Is this decoded picture worth showing? A mod that removes something ships a texture that
 * is empty or a single flat colour: it decodes fine and shows nothing.
 * Pure, so tests can hand it pixels without an image library.
 * @param bmp 4 bytes per pixel, alpha last
 */
export function worthShowing({ width, height, data }: Bitmap): boolean {
  if (!width || !height || width < 32 || height < 32) return false;
  const px = width * height;
  if (!data || data.length < px * 4) return false;
  // walk a grid of at most ~4000 samples: enough to catch "empty" and "one flat colour",
  // cheap enough for a 2048x2048 texture
  const step = Math.max(1, Math.floor(Math.sqrt(px / 4000)));
  let seen = 0;
  let visible = 0;
  let min = [255, 255, 255];
  let max = [0, 0, 0];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      seen++;
      if (data[i + 3] <= 16) continue; // transparent: nothing there to look at
      visible++;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
  }
  if (!seen || visible / seen < 0.05) return false;          // all but empty
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) >= 12; // not one flat colour
}
