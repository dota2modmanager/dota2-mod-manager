//! The app's state in one owner: settings.json, the library, the installer and the services over
//! them, built at start in the order src/services.ts and src/main.ts build them, and the window's
//! channels answered over it (the src/ipc-*.ts modules, one `owner_*` module each).
//!
//! The owner is the only writer of settings.json and the library's manifest.json, which is why
//! it takes their channels all together (docs/rust-migration.md, "The switch"). What only the
//! shell can do (a dialog, a link opened, the window told something) goes through [`Shell`], so
//! the Tauri shell and `mm-cli owner` (the parity harness, test/rust-owner.test.ts) drive the same
//! code.
//!
//! The state sits behind one lock. The TypeScript main process is one thread, so a channel there
//! never runs beside another; here each runs on a thread of its own and takes its turn at the lock.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};

use serde_json::{json, Value};

use crate::game_upkeep::GameUpkeep;
use crate::installer::Installer;
use crate::library::Library;
use crate::schema_service::SchemaService;
use crate::settings::Settings;

/// What only the shell can do.
pub trait Shell: Send + Sync {
    /// `webContents.send(channel, ...args)`: news for the window.
    fn event(&self, channel: &str, args: Vec<Value>);
    /// Something the shell answers: `dialog.open`, `dialog.save`, `dialog.message`,
    /// `shell.openExternal`, `shell.openPath`, `shell.showItemInFolder`, `clipboard.writeText`,
    /// `win.show`, `app.quit` ... (the methods src-tauri/host/host.ts asks for).
    fn request(&self, method: &str, args: Vec<Value>) -> Result<Value, String>;
}

/// How the owner is started.
pub struct Options {
    pub user_data: PathBuf,
    pub app_version: String,
    /// where the build's own files are (the changelogs)
    pub app_root: PathBuf,
    /// on a first start, the system's languages: the window takes its language from them
    pub system_languages: Option<Vec<String>>,
    /// looking for Dota where Steam keeps it; the harness hands in its own answer
    pub find_game: Box<dyn Fn() -> Option<String> + Send + Sync>,
    /// whether Dota is running; the harness hands in its own answer
    pub dota_running: Box<dyn Fn() -> bool + Send + Sync>,
    pub now: fn() -> f64,
}

/// The state the channels share.
pub struct Core {
    pub user_data: PathBuf,
    pub settings: Settings,
    pub library: Library,
    pub installer: Installer,
    pub schema: SchemaService,
    pub upkeep: GameUpkeep,
    pub remote: crate::remote_config::RemoteConfig,
    /// the support prompt counts a launch on its first question of the run
    pub launch_counted: bool,
    /// the tab the window shows, for the Discord status
    pub presence_view: String,
    /// the network, through the user's proxy
    pub net: Arc<crate::net_fetch::Net>,
    pub catalog: crate::catalog::Catalog,
    /// which catalog mod a file is, by what it hashes to
    pub fingerprints: crate::fingerprints::Fingerprints,
    /// the anti-cheat notice in plain words
    pub notice: crate::notice_text::NoticeText,
    /// how many times each catalog mod was downloaded
    pub download_stats: Arc<crate::download_stats::DownloadStats>,
    /// whether the download counter may count (settings countDownloads), read off the settings' thread
    pub counting: Arc<AtomicBool>,
    /// which of the game's items a mod's models are (src/mod-id.ts), for the game in the settings
    pub mod_id: Arc<crate::mod_id::ModIdentity>,
    /// the app's log, which the installer writes to as well
    log: Arc<Mutex<Vec<String>>>,
    /// the game folder and language folder the installer was made for
    made_for: (Option<PathBuf>, String),
}

/// The owner: the state, and the shell it answers through.
pub struct Owner {
    pub opts: Options,
    pub shell: Arc<dyn Shell>,
    core: Mutex<Core>,
    log: Arc<Mutex<Vec<String>>>,
    started: AtomicBool,
    me: Weak<Owner>,
    /// the item table's builds in the background: the newest asked for, and how many have not answered
    builds: Mutex<Builds>,
    builds_done: Condvar,
    /// one build at a time
    build_turn: Mutex<()>,
}

#[derive(Default)]
struct Builds {
    generation: u64,
    pending: usize,
}

pub type R = Result<Value, String>;

/// A group of channels (one src/ipc-*.ts module): its names, and what answers them.
type Group = (&'static [&'static str], fn(&Owner, &str, &[Value]) -> Option<R>);

/// Every group the owner answers, in the order src/main.ts registers them.
const GROUPS: &[Group] = &[
    (crate::owner_settings::CHANNELS, crate::owner_settings::handle),
    (crate::owner_library::CHANNELS, crate::owner_library::handle),
    (crate::owner_mods::CHANNELS, crate::owner_mods::handle),
    (crate::owner_foreign::CHANNELS, crate::owner_foreign::handle),
    (crate::owner_packs::CHANNELS, crate::owner_packs::handle),
];

/// The app's game folder, when one is set.
pub fn game_of(settings: &Settings) -> Option<PathBuf> {
    settings.get("dotaGamePath").filter(|v| crate::js::truthy(v)).map(|v| PathBuf::from(crate::js::string(v)))
}

impl Core {
    /// The installer made again when the game folder or the language folder changed, so it never
    /// writes into the folder the settings no longer name (the TypeScript asks settings each time).
    pub fn sync(&mut self, user_data: &Path) {
        let now = (game_of(&self.settings), self.upkeep.lang_folder().to_string());
        if now == self.made_for {
            return;
        }
        if now.0 != self.made_for.0 {
            self.mod_id = Arc::new(crate::mod_id::ModIdentity::new(now.0.clone()));
        }
        self.installer = make_installer(&now, user_data, &self.mod_id, &self.log);
        self.made_for = now;
    }

    /// The game folder, when one is set.
    pub fn game(&self) -> Option<PathBuf> {
        game_of(&self.settings)
    }
}

impl Owner {
    /// Build every service over userData, put the game folder right, and run the start's upkeep.
    pub fn start(opts: Options, shell: Arc<dyn Shell>) -> Arc<Owner> {
        let ud = opts.user_data.clone();
        let mut lines: Vec<String> = Vec::new();
        // a change the last process died in the middle of is finished or undone first
        let tx = ud.join("tx");
        let rec = crate::file_tx::recover_journals(Some(&tx), &mut |m| lines.push(m));
        if rec.undone > 0 || rec.finished > 0 {
            lines.push(format!("tx recovery: undid {}, finished {}", rec.undone, rec.finished));
        }
        let mut settings = Settings::new(&ud);
        if crate::pumpkin::begin_night_again(&mut settings).unwrap_or(false) {
            lines.push("the night starts again".into());
        }
        if let Some(langs) = &opts.system_languages {
            let _ = settings.set("uiLang", json!(crate::ui_lang::ui_lang_for(langs)));
        }
        crate::i18n::set_lang(crate::i18n::Lang::parse(settings.get("uiLang").and_then(Value::as_str).unwrap_or("")));
        let library = Library::new(&ud);
        let remote = crate::remote_config::RemoteConfig::new(&ud, &opts.app_version, None, Box::new(opts.now));
        let mut upkeep = GameUpkeep::default();
        // the start's upkeep (src/game-upkeep.ts atStart): the game folder, then the mods' folder
        let _ = crate::game_upkeep::check_game_path(
            &mut settings,
            &|p| crate::installer::validate_game_path(p),
            &mut || (opts.find_game)(),
            &mut |m| lines.push(m),
        );
        upkeep.lang_folder_step(&mut settings, &mut || (opts.dota_running)(), &mut |m| lines.push(m));
        let made_for = (game_of(&settings), upkeep.lang_folder().to_string());
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mod_id = Arc::new(crate::mod_id::ModIdentity::new(made_for.0.clone()));
        let installer = make_installer(&made_for, &ud, &mod_id, &log);
        let schema = SchemaService::new(&ud, true);
        let net = Arc::new(crate::net_fetch::Net::new(opts.now));
        if let Ok(Some(p)) =
            crate::net_fetch::validate_download_proxy(settings.get("downloadProxy").unwrap_or(&Value::Null))
        {
            net.set_proxy(Some(&p));
        }
        let now = opts.now;
        let catalog = crate::catalog::Catalog::new(&ud, None, None, Box::new(now));
        let counting = Arc::new(AtomicBool::new(settings.get("countDownloads") != Some(&Value::Bool(false))));
        let on = counting.clone();
        // the counter's token is written beside the build by CI, never committed
        let token = std::fs::read_to_string(opts.app_root.join("src").join("download-stats.token"))
            .ok()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        let stats_log = log.clone();
        let download_stats = crate::download_stats::DownloadStats::new(
            &ud.join("download-counts.json"),
            Box::new(move || on.load(Ordering::SeqCst)),
            token,
            None,
            net.clone(),
            Box::new(now),
            Box::new(move |m: &str| stats_log.lock().unwrap_or_else(|e| e.into_inner()).push(m.to_string())),
        );
        let core = Core {
            user_data: ud.clone(),
            settings,
            library,
            installer,
            schema,
            upkeep,
            remote,
            launch_counted: false,
            presence_view: "catalog".into(),
            net,
            catalog,
            fingerprints: crate::fingerprints::Fingerprints::new(&ud),
            notice: crate::notice_text::NoticeText::default(),
            download_stats,
            counting,
            mod_id,
            log: log.clone(),
            made_for,
        };
        let owner = Arc::new_cyclic(|me| Owner {
            opts,
            shell,
            core: Mutex::new(core),
            log: {
                log.lock().unwrap_or_else(|e| e.into_inner()).splice(0..0, lines);
                log
            },
            started: AtomicBool::new(false),
            me: me.clone(),
            builds: Mutex::new(Builds::default()),
            builds_done: Condvar::new(),
            build_turn: Mutex::new(()),
        });
        owner.start_steps();
        owner.started.store(true, Ordering::SeqCst);
        owner
    }

    fn start_steps(&self) {
        let mut core = self.core();
        let c = &mut *core;
        let mut lines: Vec<String> = Vec::new();
        {
            let mut log = |m: String| lines.push(m);
            let mut deployed = |_: std::collections::HashSet<String>| {};
            let mut ctx = crate::schema_service::Ctx {
                inst: &c.installer,
                lib: &mut c.library,
                settings: &mut c.settings,
                bases: None,
                log: &mut log,
                on_deployed: &mut deployed,
            };
            let running = &self.opts.dota_running;
            c.upkeep.start_steps(
                &mut c.schema,
                &mut ctx,
                &mut || running(),
                None,
                None,
                &mut |name, ctx| other_step(name, ctx),
                (self.opts.now)(),
            );
        }
        drop(core);
        for l in lines {
            self.diag(&l);
        }
    }

    /// The state, for one channel's turn.
    pub fn core(&self) -> MutexGuard<'_, Core> {
        let mut g = self.core.lock().unwrap_or_else(|e| e.into_inner());
        let ud = self.opts.user_data.clone();
        g.sync(&ud);
        g
    }

    /// A line in the app's log.
    pub fn diag(&self, msg: &str) {
        self.log.lock().unwrap_or_else(|e| e.into_inner()).push(msg.to_string());
    }

    /// The log so far, emptied (the harness compares it).
    pub fn take_log(&self) -> Vec<String> {
        std::mem::take(&mut *self.log.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// The window's bar at the bottom.
    pub fn progress(&self, evt: Value) {
        self.shell.event("progress", vec![evt]);
    }

    /// One of the window's channels, when it is the owner's.
    pub fn invoke(&self, channel: &str, args: &[Value]) -> Option<R> {
        GROUPS.iter().find_map(|(_, handle)| handle(self, channel, args))
    }

    /// Every channel the owner answers.
    pub fn channels() -> Vec<&'static str> {
        GROUPS.iter().flat_map(|(names, _)| names.iter().copied()).collect()
    }

    /// The answer when a feature may not run now: Dota is open and holds its files, or the remote
    /// config switched it off (src/feature-gate.ts).
    pub fn blocked(&self, name: &str) -> Option<Value> {
        let open = (self.opts.dota_running)();
        let core = self.core();
        let lang = crate::feature_gate::note_lang(&Value::Object(core.settings.all()));
        crate::feature_gate::gate(open, || core.remote.feature(name, lang))
    }

    /// Build the item table again in the background (src/background-builds.ts): a build asked for
    /// while one runs stops that one before it writes, and the newest builds from the library as it
    /// is then. The receiver answers once this build, or the one that took over, is done.
    pub fn refresh_schema_in_background(&self) -> std::sync::mpsc::Receiver<Value> {
        let gen = {
            let mut b = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            b.generation += 1;
            b.pending += 1;
            b.generation
        };
        let (tx, rx) = std::sync::mpsc::channel();
        let Some(me) = self.me.upgrade() else { return rx };
        std::thread::spawn(move || {
            let turn = me.build_turn.lock().unwrap_or_else(|e| e.into_inner());
            let newest = |o: &Owner| o.builds.lock().unwrap_or_else(|e| e.into_inner()).generation;
            let out = if newest(&me) != gen {
                json!({ "ok": true, "superseded": true })
            } else {
                me.refresh_schema(&|| newest(&me) != gen)
            };
            drop(turn);
            let _ = tx.send(out);
            let mut b = me.builds.lock().unwrap_or_else(|e| e.into_inner());
            b.pending -= 1;
            me.builds_done.notify_all();
        });
        rx
    }

    /// Wait until no build of the item table is running or asked for (the Play button waits on it).
    pub fn settled(&self) {
        let mut b = self.builds.lock().unwrap_or_else(|e| e.into_inner());
        while b.pending > 0 {
            b = self.builds_done.wait(b).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// One build of the item table, the bar at the bottom counting the picks built anew
    /// (src/build-bar.ts: shown after 400 ms, and only when there are picks to build).
    fn refresh_schema(&self, stop: &dyn Fn() -> bool) -> Value {
        let label = crate::i18n::t("Сборка предметов", &[]);
        let started = (self.opts.now)();
        let mut shown = false;
        let mut lines: Vec<String> = Vec::new();
        let out = {
            let mut core = self.core();
            let c = &mut *core;
            let mut log = |m: String| lines.push(m);
            let mut deployed = |_: std::collections::HashSet<String>| {};
            let mut ctx = crate::schema_service::Ctx {
                inst: &c.installer,
                lib: &mut c.library,
                settings: &mut c.settings,
                bases: None,
                log: &mut log,
                on_deployed: &mut deployed,
            };
            let mut progress = |done: usize, total: usize| {
                if total == 0 || (!shown && (self.opts.now)() - started < 400.0) {
                    return;
                }
                shown = true;
                self.progress(
                    json!({ "type": "count", "label": label, "done": done, "total": total, "cancel": "schema" }),
                );
            };
            c.schema.refresh(&mut ctx, stop, &mut progress)
        };
        if shown {
            self.progress(json!({ "type": "done" }));
        }
        for l in lines {
            self.diag(&l);
        }
        serde_json::to_value(out).unwrap_or(Value::Null)
    }
}

/// The start's steps that need more than the upkeep holds (src/game-upkeep.ts atStart).
fn other_step(name: &str, ctx: &mut crate::schema_service::Ctx) -> Result<(), String> {
    let game = game_of(ctx.settings);
    match name {
        "cursor reconcile" => crate::cursors::reconcile_cursors(ctx.inst, ctx.lib, game.is_some()),
        "schema migrate" => {
            let Some(game) = game.filter(|_| crate::schema_harvest::wants_migrate(ctx.lib)) else { return Ok(()) };
            let (text, _) = crate::schema::read_game_schema(&game)?;
            let m = crate::schema_harvest::migrate(ctx.inst, ctx.lib, &text);
            if m.changed > 0 {
                (ctx.log)(format!(
                    "schema migrate: {}/{} mods cleaned, {} blocks, ~{} MB freed",
                    m.changed,
                    m.scanned,
                    m.deltas,
                    crate::js::number(m.freed_mb)
                ));
            }
        }
        "cosmetic migrate" => {
            let Some(game) = game else { return Ok(()) };
            let read = || crate::schema::read_game_schema(&game).map(|(t, _)| t);
            let read: &dyn Fn() -> Result<Vec<u8>, String> = &read;
            crate::schema_cosmetics::migrate_cosmetic_settings(ctx.lib, ctx.settings, Some(read));
        }
        // the arcana bases come with the arcana window's port; until then the build goes on from
        // the game's own files, as it does while a base downloads
        _ => {}
    }
    Ok(())
}

/// The installer over a game folder and language folder, asking the game's item table what a mod's
/// models are (src/services.ts).
fn make_installer(
    at: &(Option<PathBuf>, String),
    user_data: &Path,
    mod_id: &Arc<crate::mod_id::ModIdentity>,
    log: &Arc<Mutex<Vec<String>>>,
) -> Installer {
    let mut inst = Installer::new(at.0.clone(), &at.1).with_user_data(user_data);
    inst.journal_dir = Some(user_data.join("tx"));
    let (mid, log) = (mod_id.clone(), log.clone());
    inst.identify = Some(Box::new(move |paths: &[String]| {
        let mut lines = Vec::new();
        let g = mid.identify(paths.iter().map(String::as_str), &mut |l| lines.push(l));
        log.lock().unwrap_or_else(|e| e.into_inner()).extend(lines);
        g.map(|g| crate::installer_folder::Guess { items: g.items, slots: g.slots, hero_names: g.hero_names })
    }));
    inst
}

/// `args[i]`, or null.
pub fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}
