/* A WebM file out of VP9 frames, for the main menu background of the user's own (issue #418).
 *
 * The window encodes the picture, GIF or video with WebCodecs, which hands back frames and no
 * file; this lays them out as Matroska the way the game's movie panel reads one: a header that
 * says webm, the length of the clip (a panel that repeats seeks back to the start), one video
 * track, a cluster from each key frame on, and the cues that say where each cluster begins.
 * Nothing else is written: no audio, no tags, no chapters. */

/** One encoded frame: its bytes, when it shows in microseconds, and whether it is a key frame. */
export interface Frame { data: Uint8Array; time: number; key: boolean }

const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, FlagLacing: 0x9c, CodecID: 0x86, TrackType: 0x83,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
} as const;

const cat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

const idBytes = (id: number): Uint8Array => {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Uint8Array.from(out);
};

/** A size as an 8-byte vint: every element the same width, so an offset known early stays right. */
const size8 = (n: number): Uint8Array => {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7, v = n; i > 0; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
  return out;
};

const el = (id: number, body: Uint8Array): Uint8Array => cat([idBytes(id), size8(body.length), body]);
const uint = (id: number, n: number, width = 0): Uint8Array => {
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  while (out.length < Math.max(1, width)) out.unshift(0);
  return el(id, Uint8Array.from(out));
};
const text = (id: number, s: string): Uint8Array => el(id, new TextEncoder().encode(s));
const float = (id: number, n: number): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n);
  return el(id, b);
};

/** The longest a cluster may run: a block's time is 16 bits of milliseconds after its cluster's. */
const CLUSTER_MS = 30000;

/**
 * The WebM file of `frames`, in the order they show.
 * @param duration the clip's length in microseconds: the last frame shows until then
 */
export function muxWebm({ width, height, frames, duration }: { width: number; height: number; frames: Frame[]; duration: number }): Uint8Array {
  if (!frames.length || !frames[0].key) throw new Error('webm: the first frame has to be a key frame');
  const header = el(ID.EBML, cat([
    uint(ID.EBMLVersion, 1), uint(ID.EBMLReadVersion, 1), uint(ID.EBMLMaxIDLength, 4), uint(ID.EBMLMaxSizeLength, 8),
    text(ID.DocType, 'webm'), uint(ID.DocTypeVersion, 4), uint(ID.DocTypeReadVersion, 2),
  ]));
  const info = el(ID.Info, cat([
    uint(ID.TimecodeScale, 1000000), float(ID.Duration, duration / 1000),
    text(ID.MuxingApp, 'Dota 2 Mod Manager'), text(ID.WritingApp, 'Dota 2 Mod Manager'),
  ]));
  const tracks = el(ID.Tracks, el(ID.TrackEntry, cat([
    uint(ID.TrackNumber, 1), uint(ID.TrackUID, 1), uint(ID.FlagLacing, 0), text(ID.CodecID, 'V_VP9'), uint(ID.TrackType, 1),
    el(ID.Video, cat([uint(ID.PixelWidth, width), uint(ID.PixelHeight, height)])),
  ])));

  // a cluster at each key frame, and at the latest every 30 s of frames
  const clusters: { ms: number; blocks: Uint8Array[] }[] = [];
  for (const f of frames) {
    const ms = Math.round(f.time / 1000);
    const open = clusters[clusters.length - 1];
    if (!open || f.key || ms - open.ms >= CLUSTER_MS) {
      if (!f.key && open && ms - open.ms >= CLUSTER_MS) throw new Error('webm: more than 30 s without a key frame');
      clusters.push({ ms, blocks: [] });
    }
    const c = clusters[clusters.length - 1];
    const head = new Uint8Array(4);
    head[0] = 0x81; // track 1
    new DataView(head.buffer).setInt16(1, ms - c.ms);
    head[3] = f.key ? 0x80 : 0x00;
    c.blocks.push(el(ID.SimpleBlock, cat([head, f.data])));
  }
  const clusterBytes = clusters.map((c) => el(ID.Cluster, cat([uint(ID.Timecode, c.ms), ...c.blocks])));

  // the seek head names where Info, Tracks and Cues start; its own size does not depend on them
  const seek = (id: number, pos: number) => el(ID.Seek, cat([el(ID.SeekID, idBytes(id)), uint(ID.SeekPosition, pos, 8)]));
  const seekHeadSize = el(ID.SeekHead, cat([seek(ID.Info, 0), seek(ID.Tracks, 0), seek(ID.Cues, 0)])).length;
  const infoAt = seekHeadSize;
  const tracksAt = infoAt + info.length;
  let at = tracksAt + tracks.length;
  const points: Uint8Array[] = [];
  clusters.forEach((c, i) => {
    points.push(el(ID.CuePoint, cat([uint(ID.CueTime, c.ms), el(ID.CueTrackPositions, cat([uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, at, 8)]))])));
    at += clusterBytes[i].length;
  });
  const cues = el(ID.Cues, cat(points));
  const seekHead = el(ID.SeekHead, cat([seek(ID.Info, infoAt), seek(ID.Tracks, tracksAt), seek(ID.Cues, at)]));
  return cat([header, el(ID.Segment, cat([seekHead, info, tracks, ...clusterBytes, cues]))]);
}
