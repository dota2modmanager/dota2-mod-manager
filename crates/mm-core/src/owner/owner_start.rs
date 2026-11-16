//! What the start sets going and does not wait for (src/services.ts): the remote config, then the
//! catalog's second copies it names; the ready-made presets; the map from a file's fingerprint to
//! its catalog mod. Each is fetched off the owner's lock, so the window is answered meanwhile, and
//! being offline leaves the last good copy in place. Once the item table has settled, a rank look
//! built with an older script is built again. A while later, the installed tools are brought up to
//! their pins.

use std::sync::Arc;

use crate::net_fetch::FetchOptions;
use crate::owner::Owner;

/// The fetches, one after another on a thread of their own, and the tools' catch-up after them.
pub fn refresh(o: &Arc<Owner>) {
    let me = o.clone();
    std::thread::spawn(move || refresh_now(&me));
    // after the table, not on top of it: both are long writes to the game's language folder
    let me = o.clone();
    std::thread::spawn(move || {
        me.settled();
        rank_script(&me);
    });
    // the tools wait until the start's own downloads are done
    let me = Arc::downgrade(o);
    std::thread::spawn(move || {
        std::thread::sleep(TOOLS_AFTER);
        if let Some(o) = me.upgrade() {
            crate::owner_game::catch_up_tools(&o);
        }
    });
}

/// How long after start the installed tools are brought up to their pins.
pub const TOOLS_AFTER: std::time::Duration = std::time::Duration::from_secs(15);

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

/// A rank look whose pak carries another build's script (`SCRIPT_MARK`) built again with this
/// one's, so a fix to the script reaches the players who already had the look on.
pub fn rank_script(o: &Owner) {
    let mut lines: Vec<String> = Vec::new();
    crate::owner_tools::rank_script_again(&mut o.core(), &mut |m| lines.push(m));
    for l in lines {
        o.diag(&l);
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

    /// The mark a rank look was built with, against this build's: an older one is built again, the
    /// same one is left alone. Nothing called this at start after the TypeScript went, so a change
    /// to the script never reached a look already on.
    #[test]
    fn a_rank_look_built_with_another_script_is_built_again_and_the_same_one_is_not() {
        for (script, again) in [("0123456789ab", true), (crate::rank_look::SCRIPT_MARK, false)] {
            let ud = std::env::temp_dir().join(format!("mm-owner-rank-{}", uuid::Uuid::new_v4().simple()));
            std::fs::create_dir_all(&ud).unwrap();
            std::fs::write(ud.join("settings.json"), "{}").unwrap();
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
            {
                let mut c = o.core();
                let rec = json!({ "name": "Rank look", "categoryId": "hud", "files": [] });
                let made = c.library.add(&rec, None).unwrap();
                let generated = json!({ "generated": { "rank": { "levels": {} }, "script": script } });
                c.library.update(&made["id"], &generated, None).unwrap();
            }
            rank_script(&o);
            let log = o.take_log();
            let changed = log.iter().any(|l| l.contains("rank look: the script changed"));
            assert_eq!(changed, again, "{script}: {log:?}");
            drop(o);
            let _ = std::fs::remove_dir_all(ud);
        }
    }
}
