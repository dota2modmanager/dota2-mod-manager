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
}
