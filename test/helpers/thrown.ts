/* What a test gets hold of when something it called threw: an Error, with the marks this app
 * puts on one so a caller can tell a refusal from an accident without reading its wording. */
export type Thrown = Error & {
  /** refused by the archive door (src/safe-zip.ts) */
  safeZip?: boolean;
  /** no mirror could be reached at all (src/net.ts) */
  offline?: boolean;
  /** no copy matched the expected hash (src/net.ts) */
  checksum?: boolean;
  /** Node's own error code, ENOENT and the like */
  code?: string;
};
