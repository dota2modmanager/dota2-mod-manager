//! Auto-update as the owner runs it (src/main.ts createUpdater, src/updater.ts): the driver in
//! updater.rs aims the shell's updater at a feed and a channel, hears what it finds, and tells the
//! window. The channel is read on every look, from the account, the signed config's list of
//! testers and the setting, so a tester taken off the list is back on stable at the next look.
//! Only the shell starts it, and only in a packaged build that is not held to a sandbox.

use std::sync::{Arc, Mutex, Weak};

use serde_json::json;

use crate::owner::Owner;
use crate::updater::{Updater, UpdaterLike, EVERY};

/// The driver, around the shell's updater.
pub type Driver = Mutex<Updater<Box<dyn UpdaterLike + Send>>>;

/// The channel this copy reads now: `latest`, or `beta` for an account the config names.
pub fn channel(o: &Owner) -> String {
    let c = o.core();
    let id =
        c.settings.get("account").and_then(|a| a.get("id")).filter(|v| crate::js::truthy(v)).map(crate::js::string);
    let wanted = c.settings.get("betaChannel") == Some(&serde_json::Value::Bool(true));
    crate::beta::channel_for(id.as_deref(), &c.remote.beta(), wanted).to_string()
}

/// Starts the driver over the shell's updater, looks once, and again every four hours.
pub fn start(o: &Arc<Owner>, inner: Box<dyn UpdaterLike + Send>) {
    let (ch, tell, log) = (Arc::downgrade(o), Arc::downgrade(o), Arc::downgrade(o));
    let driver = Updater::new(
        inner,
        // a portable copy is told a version exists and fetches it beside itself on a click
        crate::portable_update::portable_dir().is_some(),
        Box::new(move || ch.upgrade().map(|o| channel(&o)).unwrap_or_else(|| "latest".into())),
        Box::new(move |news| {
            if let Some(o) = tell.upgrade() {
                o.shell.event("update", vec![json!(news)]);
            }
        }),
        Box::new(move |m| {
            if let Some(o) = log.upgrade() {
                o.diag(m);
            }
        }),
    );
    if o.updater.set(Mutex::new(driver)).is_err() {
        return;
    }
    with(o, |u| u.start());
    let weak = Arc::downgrade(o);
    std::thread::spawn(move || rounds(weak));
}

fn rounds(o: Weak<Owner>) {
    loop {
        std::thread::sleep(std::time::Duration::from_millis(EVERY));
        let Some(o) = o.upgrade() else { return };
        with(&o, |u| u.round());
    }
}

/// The driver, when the shell started one.
pub fn with<T>(o: &Owner, f: impl FnOnce(&mut Updater<Box<dyn UpdaterLike + Send>>) -> T) -> Option<T> {
    let d = o.updater.get()?;
    let mut u = d.lock().unwrap_or_else(|e| e.into_inner());
    Some(f(&mut u))
}

/// The channel may have changed (the beta switch, a sign-out): look now rather than in four hours.
/// Off the calling thread, which holds the state's lock.
pub fn recheck(o: &Owner) {
    if o.updater.get().is_none() {
        return;
    }
    let Some(me) = o.me() else { return };
    std::thread::spawn(move || {
        with(&me, |u| {
            u.recheck();
        });
    });
}

/// What the shell's updater found, heard from its own thread.
pub fn available(o: &Owner, version: &str) {
    with(o, |u| u.available(version));
}

pub fn downloaded(o: &Owner, version: &str) {
    with(o, |u| u.downloaded(version));
}

pub fn error(o: &Owner, message: &str) {
    with(o, |u| u.error(message));
}

/// For the support report: whether this copy updates itself, and what went wrong last.
pub fn report(o: &Owner) -> Option<serde_json::Value> {
    with(o, |u| json!({ "available": true, "lastError": u.last_error() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{Options, Shell};
    use crate::updater::Feed;
    use serde_json::Value;

    /// The window's side: what it was told on the update channel.
    #[derive(Default)]
    struct Told(Mutex<Vec<Value>>);
    impl Shell for Told {
        fn event(&self, channel: &str, args: Vec<Value>) {
            if channel == "update" {
                self.0.lock().unwrap().push(Value::Array(args));
            }
        }
        fn request(&self, _method: &str, _args: Vec<Value>) -> Result<Value, String> {
            Ok(Value::Null)
        }
    }

    /// What the shell's updater was asked to do.
    struct Seen(Arc<Mutex<Vec<String>>>);
    impl UpdaterLike for Seen {
        fn set_channel(&mut self, name: &str) {
            self.0.lock().unwrap().push(format!("channel {name}"));
        }
        fn set_allow_prerelease(&mut self, _: bool) {}
        fn set_auto_download(&mut self, on: bool) {
            self.0.lock().unwrap().push(format!("auto {on}"));
        }
        fn set_feed(&mut self, feed: Feed) -> Result<(), String> {
            self.0.lock().unwrap().push(format!("github {}", matches!(feed, Feed::Github { .. })));
            Ok(())
        }
        fn check(&mut self) {
            self.0.lock().unwrap().push("check".into());
        }
    }

    #[test]
    fn the_driver_looks_on_the_settings_channel_and_tells_the_window() {
        let ud = std::env::temp_dir().join(format!("mm-owner-update-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        std::fs::write(ud.join("settings.json"), r#"{"uiLang":"en"}"#).unwrap();
        let told = Arc::new(Told::default());
        let o = Owner::start(
            Options {
                user_data: ud.clone(),
                app_version: "9.9.9".into(),
                app_root: ud.clone(),
                downloads: ud.clone(),
                uninstall: false,
                system_languages: None,
                find_game: Box::new(|| None),
                dota_running: Box::new(|| false),
                now: crate::net_fetch::now_ms,
            },
            told.clone(),
        );
        assert!(report(&o).is_none(), "no updater until the shell starts one");
        let seen = Arc::new(Mutex::new(Vec::new()));
        start(&o, Box::new(Seen(seen.clone())));
        assert_eq!(*seen.lock().unwrap(), ["auto true", "channel latest", "github true", "check"]);
        available(&o, "9.9.10");
        downloaded(&o, "9.9.10");
        assert_eq!(
            *told.0.lock().unwrap(),
            [
                json!([{ "type": "available", "version": "9.9.10" }]),
                json!([{ "type": "downloaded", "version": "9.9.10" }])
            ]
        );
        // GitHub failed: remembered for the report, and the same look goes to the mirror
        error(&o, "offline");
        assert_eq!(report(&o).unwrap()["lastError"], json!("offline"));
        assert_eq!(seen.lock().unwrap().iter().filter(|s| *s == "github false").count(), 1);
        drop(o);
        let _ = std::fs::remove_dir_all(&ud);
    }
}
