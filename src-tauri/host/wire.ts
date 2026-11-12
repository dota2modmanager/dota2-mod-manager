/* Bytes across a JSON line: a Buffer, a typed array or an ArrayBuffer travels as {$b64: '...'}.
 * The same rule holds in the window (src-tauri/src/bridge.js) and in Rust (src-tauri/src/wire.rs).
 */

/** Turn every run of bytes inside `value` into {$b64}, leaving the rest as it is. */
export function encode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return { $b64: value.toString('base64') };
  if (ArrayBuffer.isView(value)) return { $b64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  if (value instanceof ArrayBuffer) return { $b64: Buffer.from(value).toString('base64') };
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [k, encode(v)]));
  if (value instanceof Set) return [...value].map(encode);
  if (Array.isArray(value)) return value.map(encode);
  if (value instanceof Error) return { message: value.message, name: value.name };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== 'function') out[k] = encode(v);
  return out;
}

/** The other way: every {$b64} back to a Buffer. */
export function decode(value: unknown): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const obj = value as Record<string, unknown>;
  if (typeof obj.$b64 === 'string' && Object.keys(obj).length === 1) return Buffer.from(obj.$b64, 'base64');
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = decode(v);
  return out;
}
