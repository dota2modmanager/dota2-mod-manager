// Getting bytes from the internet, on a connection that may not want to cooperate.
//
// Everything the app downloads - the catalog JSON, the fingerprint map, every mod archive -
// sits in a GitHub repository, and raw.githubusercontent.com is exactly the host that is
// slow, throttled or plainly unreachable for a good part of the userbase. So each URL has
// mirrors of the same bytes, tried in order, and a host that keeps failing is stood down for
// a while instead of being asked again on every single file.
//
// Which mirrors, measured rather than copied from another project (2026-08-07, from here):
//   raw.githubusercontent.com   210 ms, Range supported            - first choice
//   ghproxy.net                 300 ms, Range supported
//   gh-proxy.com                230 ms, Range supported
//   ghfast.top                 1100 ms, Range supported            - last, it is the slowest
//   cdn.jsdelivr.net            300 ms, Range supported, but 403 on a 64 MB file
// jsDelivr caps file size on /gh/, so it serves the small JSON and never the archives. That
// is the whole reason the chain depends on what is being fetched.
//
// The code is kept as three files: src/net-mirrors.ts is the chain and how each host is doing,
// src/net-fetch.ts asks along it, and src/net-download.ts brings a file to disk through it.
// Callers import from here.
export { RAW_HOST, FAIL_THRESHOLD, COOLDOWN_MS, DEFAULT_MIRRORS, mirrorsFor, entriesFor, mirrorHealth, resetHealth, setMirrors, applyMirrors } from './net-mirrors.ts';
export type { Mirror, Entry } from './net-mirrors.ts';
export { fetchMirrored, fetchText } from './net-fetch.ts';
export type { FetchOptions } from './net-fetch.ts';
export { sha256, downloadFile } from './net-download.ts';
export type { Download } from './net-download.ts';
