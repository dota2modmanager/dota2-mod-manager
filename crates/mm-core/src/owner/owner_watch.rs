//! Whether Dota is open, asked of the system every few seconds and told to the window when it
//! changes, and Dota closing seconds after Play (src/game-launch.ts watchGame). The logic is in
//! game_watch.rs; this is its loop over the owner's state, on a thread of its own that ends with
//! the owner.

use std::sync::Arc;

use serde_json::Value;

use crate::game_watch::{tell, CrashWatch, GameWatch};
use crate::owner::Owner;

/// The two watches the owner keeps between the loop's turns.
#[derive(Debug, Default)]
pub struct Watches {
    pub game: GameWatch,
    pub crash: CrashWatch,
}

/// One turn: the system's answer taken in, what the window is to be told, and when to ask again.
pub fn turn(o: &Owner, open: bool) -> u64 {
    let now = (o.opts.now)();
    let mut lines = Vec::new();
    let (told, wait) = {
        let mut c = o.core();
        let c = &mut *c;
        let mods = c.library.list().to_vec();
        let before = c.settings.get("lastGoodGameAt").and_then(Value::as_f64);
        let mut last_good = before;
        let told =
            tell(&mut c.watches.game, &mut c.watches.crash, open, now, &mut last_good, &mods, &mut |l| lines.push(l));
        if last_good != before {
            let _ = c.settings.set("lastGoodGameAt", last_good.map_or(Value::Null, crate::js::json_number));
        }
        (told, c.watches.game.wait_ms())
    };
    for l in lines {
        o.diag(&l);
    }
    for (channel, value) in told {
        o.shell.event(channel, vec![value]);
    }
    wait
}

/// The loop, started once the window is up; it ends when the owner is gone.
pub fn start(o: &Arc<Owner>) {
    let weak = Arc::downgrade(o);
    std::thread::spawn(move || loop {
        let Some(o) = weak.upgrade() else { break };
        let open = (o.opts.dota_running)();
        let wait = turn(&o, open);
        drop(o);
        std::thread::sleep(std::time::Duration::from_millis(wait));
    });
}

/// The patch watcher (src/main.ts createPatchWatcher): from the build the last start saw, a
/// patch landing while the app is open is repaired at once. With safe mode off the search path
/// belongs in the game, so Steam's file check taking it out counts as a patch too.
pub fn start_patch(o: &Arc<Owner>) {
    let (w1, w2, w3, w4) = (Arc::downgrade(o), Arc::downgrade(o), Arc::downgrade(o), Arc::downgrade(o));
    let watcher = crate::patch_watch::PatchWatcher::new(
        Box::new(move || w1.upgrade().and_then(|o| o.core().game())),
        Box::new(move |e| {
            if let Some(o) = w2.upgrade() {
                crate::owner_game::repair_after_patch(&o, serde_json::to_value(e).map_err(|e| e.to_string())?);
            }
            Ok(())
        }),
        Box::new(move || {
            w3.upgrade().is_some_and(|o| o.core().settings.get("schemaPatch") == Some(&Value::Bool(true)))
        }),
        Box::new(move |m| {
            if let Some(o) = w4.upgrade() {
                o.diag(m);
            }
        }),
        None,
    );
    if o.patch_watcher.set(watcher.clone()).is_err() {
        return;
    }
    let stamp = o.core().settings.get("gameStamp").and_then(Value::as_str).map(str::to_string);
    watcher.start(stamp);
}

/// A page loaded afresh has not heard the answer yet: the next turn tells it.
pub fn page_loaded(o: &Owner) {
    o.core().watches.game.start();
}

/// Play was pressed: a close within the minute after it is a crash worth naming.
pub fn launched(o: &Owner) {
    let now = (o.opts.now)();
    o.core().watches.crash.launched(now);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{Options, Shell};
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    static NOW: AtomicU64 = AtomicU64::new(1_800_000_000_000);
    fn now() -> f64 {
        NOW.load(Ordering::SeqCst) as f64
    }

    #[derive(Default)]
    struct Told(Mutex<Vec<(String, Value)>>);
    impl Shell for Told {
        fn event(&self, channel: &str, args: Vec<Value>) {
            self.0.lock().unwrap().push((channel.to_string(), args.into_iter().next().unwrap_or(Value::Null)));
        }
        fn request(&self, _method: &str, _args: Vec<Value>) -> Result<Value, String> {
            Ok(Value::Null)
        }
    }

    #[test]
    fn the_window_hears_of_dota_once_per_change_and_of_a_crash_after_play() {
        let ud = std::env::temp_dir().join(format!("mm-owner-watch-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        std::fs::write(ud.join("settings.json"), "{}").unwrap();
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
                now,
            },
            told.clone(),
        );
        let take = || std::mem::take(&mut *told.0.lock().unwrap());
        take();
        assert_eq!(turn(&o, false), 5000);
        assert_eq!(take(), vec![("game:running".to_string(), json!(false))]);
        turn(&o, false);
        assert!(take().is_empty(), "nothing new, nothing told");
        page_loaded(&o);
        turn(&o, false);
        assert_eq!(take().len(), 1, "a fresh page is told again");
        launched(&o);
        assert_eq!(turn(&o, true), 1000);
        NOW.fetch_add(5_000, Ordering::SeqCst);
        turn(&o, false);
        let got = take();
        assert_eq!(got[0], ("game:running".to_string(), json!(true)));
        assert_eq!(got[1], ("game:running".to_string(), json!(false)));
        assert_eq!(got[2].0, "game:quickExit");
        assert_eq!(got[2].1["seconds"], json!(5));
        // a full game afterwards is the last good one
        turn(&o, true);
        NOW.fetch_add(120_000, Ordering::SeqCst);
        turn(&o, false);
        assert_eq!(o.core().settings.get("lastGoodGameAt"), Some(&crate::js::json_number(now())));
        drop(o);
        let _ = std::fs::remove_dir_all(ud);
    }

    #[test]
    fn a_patch_landing_while_the_app_is_open_is_repaired_and_a_new_folder_is_watched() {
        let ud = std::env::temp_dir().join(format!("mm-owner-patch-{}", uuid::Uuid::new_v4().simple()));
        let game = ud.join("game");
        std::fs::create_dir_all(game.join("dota")).unwrap();
        std::fs::write(game.join("dota").join("pak01_dir.vpk"), b"").unwrap();
        std::fs::write(
            game.join("dota").join("steam.inf"),
            "ClientVersion=100
",
        )
        .unwrap();
        let settings = json!({ "dotaGamePath": game.to_string_lossy(), "gameStamp": "100:?" });
        std::fs::write(ud.join("settings.json"), settings.to_string()).unwrap();
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
                now,
            },
            told.clone(),
        );
        start_patch(&o);
        let w = o.patch_watcher.get().unwrap().clone();
        assert_eq!(w.current().as_deref(), Some("100:?"));
        o.take_log();
        w.check();
        assert!(!o.take_log().iter().any(|l| l.contains("game changed")), "the same build is no patch");
        std::fs::write(
            game.join("dota").join("steam.inf"),
            "ClientVersion=101
",
        )
        .unwrap();
        w.check();
        let log = o.take_log();
        assert!(log.iter().any(|l| l.contains("game changed: 100:? -> 101:?")), "{log:?}");
        assert_eq!(w.current().as_deref(), Some("101:?"));
        // another folder picked: the watcher takes its build as the current one
        let other = ud.join("other");
        std::fs::create_dir_all(other.join("dota")).unwrap();
        std::fs::write(
            other.join("dota").join("steam.inf"),
            "ClientVersion=7
",
        )
        .unwrap();
        o.core().settings.set("dotaGamePath", json!(other.to_string_lossy())).unwrap();
        o.rearm_patch_watch();
        assert_eq!(w.current().as_deref(), Some("7:?"));
        w.stop();
        drop(o);
        let _ = std::fs::remove_dir_all(ud);
    }

    /// Dota updated while the app was closed and the item table is owed a build: the start builds
    /// it behind the window. The answer that asked for it used to be dropped, and the table stayed
    /// a patch behind until the user changed something.
    #[test]
    fn a_table_owed_a_build_at_start_is_built_in_the_background() {
        let ud = std::env::temp_dir().join(format!("mm-owner-owed-{}", uuid::Uuid::new_v4().simple()));
        let game = ud.join("game");
        let dota = game.join("dota");
        std::fs::create_dir_all(&dota).unwrap();
        let gameinfo = "\"GameInfo\"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame\t\tdota\n\t\t\tMod\t\tdota\n\t\t}\n\t}\n}\n";
        std::fs::write(dota.join("gameinfo.gi"), gameinfo).unwrap();
        std::fs::write(
            dota.join("gameinfo_branchspecific.gi"),
            "\"GameInfo\"\r\n{\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t570\r\n\t}\r\n}\r\n",
        )
        .unwrap();
        let table: crate::vpk::Bytes = b"\"items_game\"\n{\n}\n".to_vec().into();
        let pak = crate::vpk::build(&[crate::vpk::entry_at(crate::schema::SCHEMA_REL, table)]);
        std::fs::write(dota.join("pak01_dir.vpk"), pak).unwrap();
        let settings = json!({
            "dotaGamePath": game.to_string_lossy(), "schemaPatch": true, "schemaPending": true,
            "gameStamp": crate::patch_watch::game_stamp(Some(&game)),
        });
        std::fs::write(ud.join("settings.json"), settings.to_string()).unwrap();
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
                now,
            },
            Arc::new(Told::default()),
        );
        o.settled();
        let pending = o.core().settings.get("schemaPending").cloned();
        assert_eq!(pending, Some(json!(false)), "{:?}", o.take_log());
        drop(o);
        let _ = std::fs::remove_dir_all(ud);
    }

    /// A Dota update that reaches a mod the app built out of the game's files: the mod is built
    /// again rather than reported, and keeps no mark. Without the rebuild handed to the repair it
    /// stayed marked and named in the banner, and nothing built it again.
    #[test]
    fn a_patch_reaching_a_mod_the_app_built_builds_it_again_and_leaves_no_mark() {
        let ud = std::env::temp_dir().join(format!("mm-owner-rebuilt-{}", uuid::Uuid::new_v4().simple()));
        let game = ud.join("game");
        let dota = game.join("dota");
        std::fs::create_dir_all(&dota).unwrap();
        let gameinfo = "\"GameInfo\"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame\t\tdota\n\t\t\tMod\t\tdota\n\t\t}\n\t}\n}\n";
        std::fs::write(dota.join("gameinfo.gi"), gameinfo).unwrap();
        std::fs::write(
            dota.join("gameinfo_branchspecific.gi"),
            "\"GameInfo\"\r\n{\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t570\r\n\t}\r\n}\r\n",
        )
        .unwrap();
        const LAYOUT: &str = "panorama/layout/hud/hud.vxml_c";
        let pak = |layout: &[u8]| {
            let table: crate::vpk::Bytes = b"\"items_game\"\n{\n}\n".to_vec().into();
            crate::vpk::build(&[
                crate::vpk::entry_at(crate::schema::SCHEMA_REL, table),
                crate::vpk::entry_at(LAYOUT, layout.to_vec().into()),
            ])
        };
        std::fs::write(dota.join("pak01_dir.vpk"), pak(b"before")).unwrap();
        let settings =
            json!({ "dotaGamePath": game.to_string_lossy(), "gameStamp": crate::patch_watch::game_stamp(Some(&game)) });
        std::fs::write(ud.join("settings.json"), settings.to_string()).unwrap();
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
                now,
            },
            told.clone(),
        );
        // the HUD layout the app built: its own pak in the language folder, over the game's layout
        let id = {
            let mut c = o.core();
            let folder = c.installer.lang_folder().unwrap();
            std::fs::create_dir_all(&folder).unwrap();
            let mine = crate::vpk::build(&[crate::vpk::entry_at(LAYOUT, b"ours".to_vec().into())]);
            std::fs::write(folder.join("pak60_dir.vpk"), mine).unwrap();
            let rec = json!({ "name": "HUD layout", "files": [{ "root": "lang", "relPath": "pak60_dir.vpk" }] });
            let made = c.library.add(&rec, None).unwrap();
            c.library.update(&made["id"], &json!({ "generated": { "hud": 1.2 } }), None).unwrap();
            crate::js::string(&made["id"])
        };
        // the first look takes note of the game as it is
        crate::owner_game::repair_after_patch(&o, json!("manual"));
        o.take_log();
        told.0.lock().unwrap().clear();
        // the update: the layout the mod replaces is a different file now
        std::fs::write(dota.join("pak01_dir.vpk"), pak(b"after the patch")).unwrap();
        crate::owner_game::repair_after_patch(&o, json!("manual"));
        let mut log = o.take_log();
        assert!(log.iter().any(|l| l.contains("reached 1 mod(s): HUD layout")), "{log:?}");
        let sent: Vec<Value> =
            told.0.lock().unwrap().iter().filter(|(ch, _)| ch == "patch-repair").map(|(_, v)| v.clone()).collect();
        assert_eq!(sent.len(), 1, "{sent:?}");
        assert!(sent[0].get("touched").is_none(), "a mod built again is not in the banner: {sent:?}");
        let marks = {
            let c = o.core();
            let mods = crate::update_impact::impact_mods(c.library.list(), &|r| {
                c.installer.lang_file_on_disk(r).unwrap_or_default()
            });
            c.impact().marked(&mods)
        };
        assert!(!marks.contains_key(&id), "{marks:?}");
        // the build itself runs behind the repair
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while !log.iter().any(|l| l.starts_with("hud layout:")) && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
            log.extend(o.take_log());
        }
        assert!(log.iter().any(|l| l.starts_with("hud layout:")), "the layout was built again: {log:?}");
        drop(o);
        let _ = std::fs::remove_dir_all(ud);
    }
}
