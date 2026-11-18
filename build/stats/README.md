A release build gets the catalog download counter's token here: `tools/release/stats-token.mjs` writes
`download-stats.token` from a repository secret just before the Tauri build, and
`src-tauri/tauri.conf.json` bundles this folder as `app/build/stats`. The token is never committed
(`.gitignore`); a build without it counts nothing.

A release build also gets the catalog uploader's token here: `tools/release/uploader-token.mjs`
writes `uploader-token.bin` from the `UPLOADER_APP_TOKEN` repository secret just before the Tauri
build. It is AES-256-GCM encrypted with the key `crates/mm-core/src/tools/creator_upload.rs`
derives, so the token is not readable with `strings`, though anyone who unpacks a release can
recover it. The file is never committed (`.gitignore`); without the secret the script removes it,
and a source checkout or fork carries no token, so sending a mod from that build is unavailable.
