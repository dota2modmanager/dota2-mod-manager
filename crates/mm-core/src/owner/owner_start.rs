//! What the start sets going and does not wait for (src/services.ts): the remote config, then the
//! catalog's second copies it names; the ready-made presets; the map from a file's fingerprint to
//! its catalog mod. Each is fetched off the owner's lock, so the window is answered meanwhile, and
//! being offline leaves the last good copy in place.

use std::sync::Arc;

use crate::net_fetch::FetchOptions;
use crate::owner::Owner;

/// The fetches, one after another on a thread of their own.
pub fn refresh(o: &Arc<Owner>) {
    let o = o.clone();
    std::thread::spawn(move || refresh_now(&o));
}

/// The same, on this thread (the test's way in).
pub fn refresh_now(o: &Owner) {
    let (net, remote, ready) = {
        let c = o.core();
        (c.net.clone(), c.remote.clone(), c.ready.clone())
    };
    remote.refresh(&net, &mut |m| o.diag(m));
    net.chain().apply_mirrors(&remote.mirrors());
    ready.refresh(&net, &mut |m| o.diag(m));
    // no hosted map, or offline: the cached one stays
    if let Ok(text) = net.fetch_text(crate::fingerprints::FP_URL, FetchOptions::default()) {
        if let Err(e) = o.core().fingerprints.store(&text) {
            o.diag(&format!("fingerprints: kept the cached map: {e}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{Options, Shell};
    use serde_json::{json, Value};

    struct Quiet;
    impl Shell for Quiet {
        fn event(&self, _channel: &str, _args: Vec<Value>) {}
        fn request(&self, _method: &str, _args: Vec<Value>) -> Result<Value, String> {
            Ok(Value::Null)
        }
    }

    #[test]
    fn the_last_configs_mirrors_count_before_anything_is_fetched() {
        let ud = std::env::temp_dir().join(format!("mm-owner-start-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        std::fs::write(ud.join("settings.json"), "{}").unwrap();
        let config = json!({ "mirrors": [{ "id": "copy", "base": "https://copy.example/assets/files/" }] });
        std::fs::write(ud.join("remote-config.json"), config.to_string()).unwrap();
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
            Arc::new(Quiet),
        );
        let hosts = || o.core().net.chain().mirrors().iter().map(|m| m.host.clone()).collect::<Vec<_>>();
        assert!(hosts().contains(&"copy.example".to_string()), "{:?}", hosts());
        assert_eq!(o.core().remote.mirrors()[0]["host"], json!("copy.example"));
        drop(o);
        let _ = std::fs::remove_dir_all(ud);
    }
}
