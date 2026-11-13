//! Noticing that Dota was patched, or its files checked by Steam, while the app is open
//! (src/patch-watch.ts). What to do about it is the caller's (src/game-upkeep.ts).
//!
//! Two of Valve's files tell the build: dota/steam.inf's ClientVersion, bumped by every patch, and
//! the signature list, digested with the app's own line taken out so that applying the patch never
//! looks like a game update. Two more questions are asked at the same build, since the stamp cannot
//! see them: did Steam's file check take the search path out, and was it built from a gameinfo.gi
//! the game has since replaced.
//!
//! The TypeScript listens with fs.watch on the two folders. Here the files a patch rewrites are
//! looked at every couple of seconds instead (a few stats), which also never goes deaf when Steam
//! replaces a folder, the case the TypeScript re-arms its watches for.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use crate::kv::{latin1, to_latin1};
use crate::patcher;

const DEBOUNCE_MS: u64 = 3000;
const POLL_MS: u64 = 2000;

fn inf_path(game: &Path) -> PathBuf {
    game.join("dota").join("steam.inf")
}

/// The build number every Dota patch bumps, from steam.inf.
pub fn client_version(game: &Path) -> Option<String> {
    let text = latin1(&std::fs::read(inf_path(game)).ok()?);
    let re = regex::Regex::new(r"(?m)^ClientVersion=([0-9]+)").expect("a fixed pattern");
    re.captures(&text).map(|c| c[1].to_string())
}

fn signatures_digest(game: &Path) -> Option<String> {
    use sha1::Digest;
    let raw = latin1(&std::fs::read(patcher::paths(game).signatures).ok()?);
    let stripped = crate::patcher_signatures::strip_signatures(&raw);
    Some(format!("{:x}", sha1::Sha1::digest(to_latin1(&stripped)))[..16].to_string())
}

/// The build on disk as one comparable string, or None when there is no game to read.
pub fn game_stamp(game: Option<&Path>) -> Option<String> {
    let game = game.filter(|g| !g.as_os_str().is_empty())?;
    let (version, digest) = (client_version(game), signatures_digest(game));
    if version.is_none() && digest.is_none() {
        return None;
    }
    Some(format!("{}:{}", version.as_deref().unwrap_or("?"), digest.as_deref().unwrap_or("?")))
}

fn search_path_gone(game: &Path) -> bool {
    std::fs::read(patcher::paths(game).branch).is_ok_and(|b| !latin1(&b).contains(crate::patcher_gameinfo::MARKER))
}

fn search_path_outdated(game: &Path) -> bool {
    patcher::state(game, Some(patcher::FOLDER)).is_ok_and(|s| s.outdated)
}

/// What the watcher reports: the build before and after, and why when the build is the same.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PatchEvent {
    pub from: Option<String>,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

type Handler = Box<dyn Fn(&PatchEvent) -> Result<(), String> + Send + Sync>;

#[derive(Default)]
struct State {
    known: Option<String>,
    running: bool,
    gone_reported: bool,
    outdated_reported: bool,
    /// bumped by stop and rearm, so an old polling thread knows to end
    generation: u64,
}

/// Watches the game folder; `check` compares right now, the polling thread after a change settles.
pub struct PatchWatcher {
    game_path: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
    on_patch: Handler,
    expects_patch: Box<dyn Fn() -> bool + Send + Sync>,
    log: Box<dyn Fn(&str) + Send + Sync>,
    debounce: Duration,
    state: Mutex<State>,
}

/// What a patch touches, as (modified, length) per file: a change in any of them is worth a look.
fn snapshot(game: &Path) -> Vec<Option<(SystemTime, u64)>> {
    let p = patcher::paths(game);
    [inf_path(game), p.signatures, p.branch, p.gameinfo]
        .iter()
        .map(|f| std::fs::metadata(f).ok().and_then(|m| Some((m.modified().ok()?, m.len()))))
        .collect()
}

impl PatchWatcher {
    pub fn new(
        game_path: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
        on_patch: Handler,
        expects_patch: Box<dyn Fn() -> bool + Send + Sync>,
        log: Box<dyn Fn(&str) + Send + Sync>,
        debounce_ms: Option<u64>,
    ) -> Arc<PatchWatcher> {
        Arc::new(PatchWatcher {
            game_path,
            on_patch,
            expects_patch,
            log,
            debounce: Duration::from_millis(debounce_ms.unwrap_or(DEBOUNCE_MS)),
            state: Mutex::new(State::default()),
        })
    }

    fn st(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn tell(&self, e: PatchEvent) {
        if let Err(err) = (self.on_patch)(&e) {
            (self.log)(&format!("patch handler failed: {err}"));
        }
    }

    /// Compare right now, without waiting for the files to settle.
    pub fn check(&self) {
        let game = (self.game_path)();
        let game = game.as_deref().filter(|g| !g.as_os_str().is_empty());
        let stamp = game_stamp(game);
        let watched = stamp.is_some() && game.is_some() && (self.expects_patch)();
        let gone = watched && search_path_gone(game.unwrap());
        let outdated = watched && !gone && search_path_outdated(game.unwrap());
        let mut st = self.st();
        if !gone {
            st.gone_reported = false;
        }
        if !outdated {
            st.outdated_reported = false;
        }
        let same = stamp.is_some() && stamp == st.known;
        if same && gone && !st.gone_reported {
            st.gone_reported = true;
            let e = PatchEvent { from: st.known.clone(), to: stamp.unwrap(), reason: Some("files-restored") };
            drop(st);
            (self.log)("the search path is gone at the same build: Steam checked the game's files");
            return self.tell(e);
        }
        if same && outdated && !st.outdated_reported {
            st.outdated_reported = true;
            let e = PatchEvent { from: st.known.clone(), to: stamp.unwrap(), reason: Some("search-path-outdated") };
            drop(st);
            (self.log)("the search path was built from an older gameinfo.gi");
            return self.tell(e);
        }
        let Some(stamp) = stamp.filter(|_| !same) else { return };
        // remembered before the caller is told: one update is reported once even if the repair fails
        let from = st.known.replace(stamp.clone());
        drop(st);
        (self.log)(&format!("game changed: {} -> {stamp}", from.as_deref().unwrap_or("unknown")));
        self.tell(PatchEvent { from, to: stamp, reason: None });
    }

    fn arm(self: &Arc<Self>) {
        let generation = self.st().generation;
        let me = Arc::clone(self);
        // taken here, not on the thread: a change made right after arming is a change
        let mut last = (me.game_path)().map(|g| snapshot(&g));
        std::thread::spawn(move || {
            let mut changed_at: Option<std::time::Instant> = None;
            loop {
                std::thread::sleep(Duration::from_millis(POLL_MS).min(me.debounce));
                if me.st().generation != generation {
                    return;
                }
                let now = (me.game_path)().map(|g| snapshot(&g));
                if now != last {
                    last = now;
                    changed_at = Some(std::time::Instant::now());
                } else if changed_at.is_some_and(|t| t.elapsed() >= me.debounce) {
                    changed_at = None;
                    me.check();
                }
            }
        });
    }

    /// Start watching; `stamp` is what the caller already knows to be current.
    pub fn start(self: &Arc<Self>, stamp: Option<String>) {
        {
            let mut st = self.st();
            if st.running {
                return;
            }
            st.running = true;
            st.known = stamp.filter(|s| !s.is_empty()).or_else(|| game_stamp((self.game_path)().as_deref()));
        }
        self.arm();
        let known = self.current();
        (self.log)(&format!("watching for Dota patches, current build {}", known.as_deref().unwrap_or("unknown")));
    }

    pub fn stop(&self) {
        let mut st = self.st();
        st.running = false;
        st.generation += 1;
    }

    /// The game path changed (found, or picked by hand): watch the new one.
    pub fn rearm(self: &Arc<Self>) {
        let game = (self.game_path)();
        {
            let mut st = self.st();
            if !st.running {
                return;
            }
            st.generation += 1;
            st.known = game_stamp(game.as_deref());
        }
        self.arm();
        let shown = game.as_ref().map_or("nothing".into(), |g| g.to_string_lossy().into_owned());
        (self.log)(&format!("now watching {shown}, build {}", self.current().as_deref().unwrap_or("unknown")));
    }

    /// The stamp the watcher considers current.
    pub fn current(&self) -> Option<String> {
        self.st().known.clone()
    }
}
