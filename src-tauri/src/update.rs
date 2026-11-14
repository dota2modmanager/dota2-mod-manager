//! Tauri's updater (tauri-plugin-updater) behind mm_core::updater::UpdaterLike, as
//! electron-updater is behind src/updater.ts: the owner's driver (mm_core::owner_update) aims it
//! at a feed and a channel and hears back what it found. A version is fetched as soon as it is
//! found and waits here until the window's "restart" (update:install) installs it.
//!
//! The feed is a JSON manifest per channel (latest.json, beta.json) beside the release, where
//! electron-updater reads latest.yml. GitHub's "latest" release is never a prerelease, so the beta
//! channel reads the project's mirror, which carries both.

use std::sync::{Mutex, Weak};

use mm_core::owner::Owner;
use mm_core::updater::{Feed, UpdaterLike, MIRROR};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

/// The version fetched and waiting for the restart that installs it.
#[derive(Default)]
pub struct Pending(Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

/// Where one look goes: the manifest for this channel on this feed.
pub fn manifest_url(feed: &Feed, channel: &str) -> String {
    match feed {
        Feed::Github { owner, repo } if channel != mm_core::beta::BETA_CHANNEL => {
            format!("https://github.com/{owner}/{repo}/releases/latest/download/{channel}.json")
        }
        Feed::Github { .. } => format!("{MIRROR}{channel}.json"),
        Feed::Generic { url } => format!("{url}{channel}.json"),
    }
}

pub struct TauriUpdater {
    app: AppHandle,
    owner: Weak<Owner>,
    channel: String,
    auto_download: bool,
    url: String,
}

impl TauriUpdater {
    pub fn new(app: AppHandle, owner: Weak<Owner>) -> TauriUpdater {
        TauriUpdater { app, owner, channel: "latest".into(), auto_download: true, url: String::new() }
    }
}

impl UpdaterLike for TauriUpdater {
    fn set_channel(&mut self, name: &str) {
        self.channel = name.to_string();
    }
    // the manifest of the channel says which version it is; there is no list to filter
    fn set_allow_prerelease(&mut self, _on: bool) {}
    fn set_auto_download(&mut self, on: bool) {
        self.auto_download = on;
    }
    fn set_feed(&mut self, feed: Feed) -> Result<(), String> {
        let url = manifest_url(&feed, &self.channel);
        url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
        self.url = url;
        Ok(())
    }

    fn check(&mut self) {
        let (app, owner, url, fetch) = (self.app.clone(), self.owner.clone(), self.url.clone(), self.auto_download);
        tauri::async_runtime::spawn(async move {
            let found = async {
                let endpoint = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
                let up = app
                    .updater_builder()
                    .endpoints(vec![endpoint])
                    .and_then(|b| b.build())
                    .map_err(|e| e.to_string())?;
                up.check().await.map_err(|e| e.to_string())
            }
            .await;
            let Some(o) = owner.upgrade() else { return };
            let update = match found {
                Ok(Some(u)) => u,
                Ok(None) => return,
                Err(e) => return mm_core::owner_update::error(&o, &e),
            };
            let version = update.version.clone();
            mm_core::owner_update::available(&o, &version);
            if !fetch {
                return;
            }
            match update.download(|_, _| {}, || {}).await {
                Ok(bytes) => {
                    *app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some((update, bytes));
                    mm_core::owner_update::downloaded(&o, &version);
                }
                Err(e) => mm_core::owner_update::error(&o, &e.to_string()),
            }
        });
    }
}

/// The window's "restart and update": the fetched version installs (on Windows its installer
/// takes over and this process ends) and the app starts again.
pub fn install(app: &AppHandle) -> Result<serde_json::Value, String> {
    let Some((update, bytes)) = app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return Err("no update has been fetched".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_channel_reads_its_own_manifest_and_the_beta_never_reads_github_latest() {
        let gh = Feed::Github { owner: "dota2modmanager", repo: "dota2-mod-manager" };
        assert_eq!(
            manifest_url(&gh, "latest"),
            "https://github.com/dota2modmanager/dota2-mod-manager/releases/latest/download/latest.json"
        );
        assert_eq!(manifest_url(&gh, "beta"), format!("{MIRROR}beta.json"));
        assert_eq!(manifest_url(&Feed::Generic { url: MIRROR }, "latest"), format!("{MIRROR}latest.json"));
    }
}
