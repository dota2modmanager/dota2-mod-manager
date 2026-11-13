//! What the app sees of the game after Play (src/game-watch.ts, src/crash-watch.ts,
//! src/game-launch.ts, `dotaIsRunning` in src/game-upkeep.ts): whether Dota is open, asked of the
//! system every few seconds and told to the window when it changes, and whether it closed seconds
//! after Play, with the mods that are new since it last ran normally.
//!
//! While the game runs it holds its paks and gameinfo open, so the channels that write the game
//! folder answer "close Dota first" from the answer kept here. The TypeScript owns the timers;
//! here the watch says how long to wait before asking again (`wait_ms`), and the shell asks.

use std::process::Command;

use serde_json::{json, Value};

/// Whether the Dota client is running on this machine right now. Windows filters a process table
/// by image name; elsewhere the name is matched exactly (`pgrep -f` would also match the Steam
/// command line that mentions the game). A missing tool answers "not running".
pub fn dota_is_running() -> bool {
    #[cfg(windows)]
    let (out, hit) = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq dota2.exe", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        (out, |s: &str| s.to_lowercase().contains("dota2.exe"))
    };
    #[cfg(not(windows))]
    let (out, hit) =
        (Command::new("pgrep").args(["-x", "dota2"]).output(), |s: &str| s.bytes().any(|b| b.is_ascii_digit()));
    match out {
        Ok(o) if o.status.success() => hit(&String::from_utf8_lossy(&o.stdout)),
        _ => false,
    }
}

/// How often to ask while the game is closed, and while it is open.
pub const EVERY_MS: u64 = 5000;
pub const OPEN_MS: u64 = 1000;

/// The game watch: the last answer, and whether the window has heard it.
#[derive(Debug, Default)]
pub struct GameWatch {
    now: bool,
    told: bool,
    pub every_ms: Option<u64>,
    pub open_ms: Option<u64>,
}

impl GameWatch {
    /// The last answer. An answer of "open" is worth asking again at once (the shell does).
    pub fn running(&self) -> bool {
        self.now
    }

    /// A page loaded afresh has not heard the answer yet.
    pub fn start(&mut self) {
        self.told = false;
    }

    /// The system's answer taken in: Some(answer) when the window is to be told.
    pub fn observe(&mut self, next: bool) -> Option<bool> {
        if next != self.now || !self.told {
            self.now = next;
            self.told = true;
            return Some(next);
        }
        None
    }

    /// How long to wait before asking again.
    pub fn wait_ms(&self) -> u64 {
        if self.now {
            self.open_ms.unwrap_or(OPEN_MS)
        } else {
            self.every_ms.unwrap_or(EVERY_MS)
        }
    }
}

/// A run shorter than this after Play is a crash, not a game.
pub const QUICK_MS: f64 = 60_000.0;
/// Steam can take this long to start the game after Play; a start later than that was not ours.
pub const LAUNCH_WINDOW_MS: f64 = 5.0 * 60_000.0;

/// Dota closing seconds after Play. Only a launch from the app's Play button counts; a session of
/// a minute or more is a normal one, whoever started it. Nothing is switched off on its own.
#[derive(Debug)]
pub struct CrashWatch {
    launched_at: Option<f64>,
    started_at: Option<f64>,
    from_play: bool,
    pub quick_ms: f64,
    pub launch_window_ms: f64,
}

impl Default for CrashWatch {
    fn default() -> Self {
        CrashWatch {
            launched_at: None,
            started_at: None,
            from_play: false,
            quick_ms: QUICK_MS,
            launch_window_ms: LAUNCH_WINDOW_MS,
        }
    }
}

/// Mods switched on and installed after the last normal session (`since`, ms).
pub fn suspects(since: Option<f64>, mods: &[Value]) -> Vec<Value> {
    let Some(since) = since.filter(|s| *s != 0.0 && !s.is_nan()) else { return vec![] };
    mods.iter()
        .filter(|m| {
            let at = m.get("installedAt").map(crate::js::to_number).filter(|n| *n != 0.0 && !n.is_nan()).unwrap_or(0.0);
            m.get("enabled") != Some(&Value::Bool(false)) && at > since
        })
        .map(|m| json!({ "id": m.get("id").cloned().unwrap_or(Value::Null), "name": m.get("name").cloned().unwrap_or(Value::Null) }))
        .collect()
}

impl CrashWatch {
    /// Play was pressed.
    pub fn launched(&mut self, now: f64) {
        self.launched_at = Some(now);
    }

    /// The game watch's answer changed. A normal session sets `last_good` to now (the caller
    /// keeps it, settings `lastGoodGameAt`); a quick exit after Play comes back as what to tell.
    pub fn running(&mut self, open: bool, now: f64, last_good: &mut Option<f64>, mods: &[Value]) -> Option<Value> {
        if open {
            self.started_at = Some(now);
            self.from_play = self.launched_at.is_some_and(|l| now - l <= self.launch_window_ms);
            self.launched_at = None;
            return None;
        }
        let started = self.started_at.take()?;
        let ran = now - started;
        if ran >= self.quick_ms {
            *last_good = Some(now);
            return None;
        }
        self.from_play
            .then(|| json!({ "seconds": crate::js::json_number(crate::js::round(ran / 1000.0)), "suspects": suspects(*last_good, mods) }))
    }
}

/// Both watches over one process check (src/game-launch.ts): what the window is told for one
/// answer of the system, as (channel, value) pairs, and the log line for a quick exit.
pub fn tell(
    game: &mut GameWatch,
    crash: &mut CrashWatch,
    next: bool,
    now: f64,
    last_good: &mut Option<f64>,
    mods: &[Value],
    diag: &mut dyn FnMut(String),
) -> Vec<(&'static str, Value)> {
    let Some(running) = game.observe(next) else { return vec![] };
    let mut out = vec![("game:running", json!(running))];
    if let Some(exit) = crash.running(running, now, last_good, mods) {
        let n = exit["suspects"].as_array().map_or(0, Vec::len);
        diag(format!("Dota closed {}s after Play; new since the last game: {n}", crate::js::string(&exit["seconds"])));
        out.push(("game:quickExit", exit));
    }
    out
}
