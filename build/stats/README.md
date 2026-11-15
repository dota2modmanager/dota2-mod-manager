A release build gets the catalog download counter's token here: `tools/release/stats-token.mjs` writes
`download-stats.token` from a repository secret just before the Tauri build, and
`src-tauri/tauri.conf.json` bundles this folder as `app/build/stats`. The token is never committed
(`.gitignore`); a build without it counts nothing.
