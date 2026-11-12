import { resourceBlock } from './resource.ts';

import type { SnapshotPoint } from '../renderer/api/preview3d.ts';

/** SNAP uses a size header, followed by raw bytes or groups of 16 LZ tokens. */
function unpack(block: Buffer): Buffer {
  const header = block.readUInt32LE(0);
  const size = header & 0x7fffffff;
  if (size > 8 * 1024 * 1024) throw new Error('SNAP block too large');
  if (header !== size) {
    if (block.length < 4 + size) throw new Error('Truncated SNAP block');
    return block.subarray(4, 4 + size);
  }
  const out = Buffer.alloc(size);
  let input = 4, offset = 0;
  while (offset < size) {
    const mask = block.readUInt16LE(input);
    input += 2;
    for (let bit = 0; bit < 16 && offset < size; bit++) {
      if (!(mask & (1 << bit))) {
        out[offset++] = block.readUInt8(input++);
        continue;
      }
      const token = block.readUInt16LE(input);
      input += 2;
      const distance = (token >>> 4) + 1, length = (token & 15) + 3;
      if (distance > offset || length > size - offset) throw new Error('Invalid SNAP back reference');
      for (let i = 0; i < length; i++, offset++) out[offset] = out[offset - distance];
    }
  }
  return out;
}

/** Decode the attributes of a compiled snapshot without treating local points as world coordinates. */
export function snapshotPoints(file: Buffer, data: { num_particles?: unknown; attributes?: unknown; string_list?: unknown }): SnapshotPoint[] {
  const count = data.num_particles;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 32768 || !Array.isArray(data.attributes)) return [];
  const bytes = unpack(resourceBlock(file, 'SNAP').data);
  let offset = 0, position = -1, skin = -1, color = -1, normal = -1, alpha = -1, radius = -1;
  const fields: { field: number; offset: number; width: number; integer: boolean }[] = [];
  const ids: Record<string, number> = { life_duration: 1, rotation: 4, rotation_speed: 5, creation_time: 8, sequence_number: 9,
    trail_length: 10, yaw: 12, sequence_number1: 13, hitbox: 14, hitbox_offset_position: 15,
    alpha2: 16, scratch_vec: 17, scratch_float: 18, pitch: 20, glow_rgb: 22, glow_alpha: 23 };
  for (const attribute of data.attributes) {
    const type = attribute?.type;
    if (!['skinning', 'float3', 'vector', 'float', 'int', 'string', 'bone'].includes(type)) return [];
    const width = type === 'skinning' ? 24 : type === 'float3' || type === 'vector' ? 12 : 4;
    if (attribute?.name === 'position' && width === 12) position = offset;
    if (type === 'skinning') skin = offset;
    if (attribute?.name === 'color' && width === 12) color = offset;
    if (attribute?.name === 'normal' && width === 12) normal = offset;
    if (attribute?.name === 'alpha' && width === 4) alpha = offset;
    if (attribute?.name === 'radius' && width === 4) radius = offset;
    if (ids[attribute?.name] !== undefined) fields.push({ field: ids[attribute.name], offset, width, integer: type === 'int' });
    offset += count * width;
  }
  if (position < 0 || offset > bytes.length) return [];
  const names = Array.isArray(data.string_list) ? data.string_list : [];
  return Array.from({ length: count }, (_, i): SnapshotPoint => {
    const p = position + i * 12, joint = skin + i * 24;
    const weights: SnapshotPoint['weights'] = [];
    for (let k = 0; skin >= 0 && k < 4; k++) {
      const name = names[bytes.readInt16LE(joint + k * 2)];
      const weight = bytes.readFloatLE(joint + 8 + k * 4);
      if (typeof name === 'string' && name && Number.isFinite(weight) && weight > 0) weights.push([name, weight]);
    }
    const tint = color < 0 ? null : [0, 4, 8].map((axis) => bytes.readFloatLE(color + i * 12 + axis));
    const divisor = tint && Math.max(...tint) > 1 ? 255 : 1;
    const rgb = tint?.every(Number.isFinite) ? tint.map((value) => Math.min(1, Math.max(0, value / divisor))) as SnapshotPoint['color'] : undefined;
    const axis = normal < 0 ? null : [0, 4, 8].map((k) => bytes.readFloatLE(normal + i * 12 + k));
    const a = alpha < 0 ? NaN : bytes.readFloatLE(alpha + i * 4), r = radius < 0 ? NaN : bytes.readFloatLE(radius + i * 4);
    const extra: NonNullable<SnapshotPoint['attributes']> = {};
    for (const f of fields) {
      const read = (axis: number) => f.integer ? bytes.readInt32LE(f.offset + i * f.width + axis) : bytes.readFloatLE(f.offset + i * f.width + axis);
      const value = f.width === 12 ? [read(0), read(4), read(8)] as [number, number, number] : read(0);
      if ((Array.isArray(value) ? value : [value]).every(Number.isFinite)) extra[f.field] = value;
    }
    return { ...(rgb ? { color: rgb } : {}),
      ...(Object.keys(extra).length ? { attributes: extra } : {}),
      ...(axis?.every(Number.isFinite) ? { normal: axis as [number, number, number] } : {}),
      ...(Number.isFinite(a) ? { alpha: Math.min(1, Math.max(0, a)) } : {}),
      ...(Number.isFinite(r) ? { radius: Math.max(0, r) } : {}),
      position: [bytes.readFloatLE(p), bytes.readFloatLE(p + 4), bytes.readFloatLE(p + 8)], weights };
  }).filter((point) => point.position.every(Number.isFinite));
}
