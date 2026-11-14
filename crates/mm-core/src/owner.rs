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
    /// the user's Downloads folder, where a save dialog starts
    pub downloads: PathBuf,
    /// the uninstaller's run (uninstall::is_uninstall_run): its window's channels answer
    pub uninstall: bool,
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
    /// the ready-made presets, from the last good copy until the start's fetch lands
    pub ready: crate::ready_presets::ReadyPresets,
    /// the studios' services with indexes of their own (owner_tools.rs)
    pub kept: crate::owner_tools::Kept,
    /// pictures out of the game, shared with the work done without the lock
    pub game_icons: Arc<crate::game_icons::GameIcons>,
    /// pictures off the Dota wikis, for what the game and the mods have none of
    pub wiki: Arc<crate::wiki_icons::WikiIcons>,
    /// the 3D preview: its models made ready, the exporter, and the answers too big for one message
    pub hero_preview: Arc<crate::hero_preview::HeroPreview>,
    pub glb: Arc<crate::model_glb::ModelGlb>,
    pub large: crate::large_answer::LargeAnswers,
    /// the game folder as the settings have it, for the exporter's runs off the lock
    game_now: Arc<std::sync::RwLock<Option<PathBuf>>>,
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
    /// Cancel on the build bar: what the game wore before the change that started the build
    pub undo: crate::build_undo::BuildUndo,
    /// the repair after a patch asked for last; a retry of an older one stands down
    pub repair_gen: u64,
    /// the window's own errors, for the support report (diag:rendererError)
    pub renderer_errors: Vec<Value>,
    /// the app's log, which the installer writes to as well
    log: Arc<crate::app_log::AppLog>,
    /// the game folder and language folder the installer was made for
    made_for: (Option<PathBuf>, String),
}

/// The owner: the state, and the shell it answers through.
pub struct Owner {
    pub opts: Options,
    pub shell: Arc<dyn Shell>,
    core: Mutex<Core>,
    log: Arc<crate::app_log::AppLog>,
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
    (crate::owner_presets::CHANNELS, crate::owner_presets::handle),
    (crate::owner_studios::CHANNELS, crate::owner_studios::handle),
    (crate::owner_compiler::CHANNELS, crate::owner_compiler::handle),
    (crate::owner_tools::CHANNELS, crate::owner_tools::handle),
    (crate::owner_app::CHANNELS, crate::owner_app::handle),
    (crate::owner_game::CHANNELS, crate::owner_game::handle),
    (crate::owner_pictures::CHANNELS, crate::owner_pictures::handle),
    (crate::owner_preview3d::CHANNELS, crate::owner_preview3d::handle),
    (crate::owner_creator::CHANNELS, crate::owner_creator::handle),
    (crate::owner_support::CHANNELS, crate::owner_support::handle),
    (crate::owner_uninstall::CHANNELS, crate::owner_uninstall::handle),
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
            *self.game_now.write().unwrap_or_else(|e| e.into_inner()) = now.0.clone();
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
        let log = Arc::new(crate::app_log::AppLog::new(&ud));
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
            Box::new(move |m: &str| stats_log.push(m)),
        );
        let game_now = Arc::new(std::sync::RwLock::new(made_for.0.clone()));
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
            net: net.clone(),
            catalog,
            ready: crate::ready_presets::ReadyPresets::new(&ud, None),
            kept: crate::owner_tools::Kept::default(),
            game_icons: Arc::new(crate::game_icons::GameIcons::new(&ud)),
            wiki: Arc::new(crate::wiki_icons::WikiIcons::new(&ud, net.clone(), now, &opts.app_version)),
            hero_preview: Arc::new(crate::hero_preview::HeroPreview::new()),
            glb: Arc::new(model_glb(&ud, &game_now, &log)),
            large: crate::large_answer::LargeAnswers::default(),
            game_now,
            fingerprints: crate::fingerprints::Fingerprints::new(&ud),
            notice: crate::notice_text::NoticeText::default(),
            download_stats,
            counting,
            mod_id,
            undo: crate::build_undo::BuildUndo::default(),
            repair_gen: 0,
            renderer_errors: Vec::new(),
            log: log.clone(),
            made_for,
        };
        let owner = Arc::new_cyclic(|me| Owner {
            opts,
            shell,
            core: Mutex::new(core),
            log: {
                log.prepend(lines);
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
        let mut filled = None;
        {
            let mut log = |m: String| lines.push(m);
            let mut deployed = |f: std::collections::HashSet<String>| filled = Some(f);
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
        after_deploys(c, filled, &mut lines);
        // the picture Cancel goes back to: the game as it is now, unless a build is still owed
        if !c.settings.get("schemaPending").is_some_and(crate::js::truthy) {
            c.undo.mark(&c.installer, &c.library, &c.settings);
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
        self.log.push(msg);
    }

    /// The log so far, emptied (the harness compares it).
    pub fn take_log(&self) -> Vec<String> {
        self.log.take()
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

    /// Stop the build of the item table that is running, if one is: false when none was.
    pub fn cancel_builds(&self) -> bool {
        let mut b = self.builds.lock().unwrap_or_else(|e| e.into_inner());
        if b.pending == 0 {
            return false;
        }
        b.generation += 1;
        true
    }

    /// The owner itself, for work that outlives the call (a retry later).
    pub fn me(&self) -> Option<Arc<Owner>> {
        self.me.upgrade()
    }

    /// Wait until no build of the item table is running or asked for (the Play button waits on it).
    pub fn settled(&self) {
        let mut b = self.builds.lock().unwrap_or_else(|e| e.into_inner());
        while b.pending > 0 {
            b = self.builds_done.wait(b).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// What a Dota update broke put right (src/schema-service.ts heal): the search-path patch, or
    /// the game's own file in safe mode; a table that needs building again is built in the
    /// background.
    pub fn heal(&self) -> Value {
        let mut lines: Vec<String> = Vec::new();
        let healed = {
            let mut core = self.core();
            let c = &mut *core;
            let mut filled = None;
            let healed = {
                let mut log = |m: String| lines.push(m);
                let mut deployed = |f: std::collections::HashSet<String>| filled = Some(f);
                let mut ctx = crate::schema_service::Ctx {
                    inst: &c.installer,
                    lib: &mut c.library,
                    settings: &mut c.settings,
                    bases: None,
                    log: &mut log,
                    on_deployed: &mut deployed,
                };
                c.schema.heal(&mut ctx, true)
            };
            after_deploys(c, filled, &mut lines);
            healed
        };
        for l in lines {
            self.diag(&l);
        }
        if healed.rebuild {
            drop(self.refresh_schema_in_background());
        }
        serde_json::to_value(&healed).unwrap_or(Value::Null)
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
            let mut filled = None;
            let out = {
                let mut log = |m: String| lines.push(m);
                let mut deployed = |f: std::collections::HashSet<String>| filled = Some(f);
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
            after_deploys(c, filled, &mut lines);
            out
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

/// What follows a table written or dropped (src/services.ts onDeployed): the arcanas give way to
/// the builder's picks over the paths they share, and Cancel's picture is taken again.
fn after_deploys(c: &mut Core, filled: Option<std::collections::HashSet<String>>, lines: &mut Vec<String>) {
    let Some(filled) = filled else { return };
    let game = c.game();
    let filled: std::collections::BTreeSet<String> = filled.into_iter().collect();
    let arcana = c.kept.arcana(&game);
    arcana.give_way(&c.installer, &mut c.library, &filled, None, &mut |m| lines.push(m));
    c.undo.mark(&c.installer, &c.library, &c.settings);
}

/// The 3D preview's exporter: the toolchain's decoder over the game in the settings.
fn model_glb(
    ud: &Path,
    game: &Arc<std::sync::RwLock<Option<PathBuf>>>,
    log: &Arc<crate::app_log::AppLog>,
) -> crate::model_glb::ModelGlb {
    let (tools, game, log) = (ud.to_path_buf(), game.clone(), log.clone());
    crate::model_glb::ModelGlb::new(
        ud,
        Box::new(move || crate::toolchain::Toolchain::new(&tools, None).path_of("vrf")),
        Box::new(move || game.read().unwrap_or_else(|e| e.into_inner()).clone()),
        Box::new(|exe, args| crate::owner_tools::run_tool(&exe.to_string_lossy(), args)),
        Box::new(move |m| log.push(m)),
    )
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
    log: &Arc<crate::app_log::AppLog>,
) -> Installer {
    let mut inst = Installer::new(at.0.clone(), &at.1).with_user_data(user_data);
    inst.journal_dir = Some(user_data.join("tx"));
    let (mid, log) = (mod_id.clone(), log.clone());
    inst.identify = Some(Box::new(move |paths: &[String]| {
        let mut lines = Vec::new();
        let g = mid.identify(paths.iter().map(String::as_str), &mut |l| lines.push(l));
        log.extend(lines);
        g.map(|g| crate::installer_folder::Guess { items: g.items, slots: g.slots, hero_names: g.hero_names })
    }));
    inst
}

/// `args[i]`, or null.
pub fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}

/// Bytes a channel was handed: `{$b64}` off the wire, a plain list of numbers, or a typed array as
/// JSON (`{"0": 1, ...}`); None for nothing at all.
pub fn bytes_of(v: &Value) -> Result<Option<Vec<u8>>, String> {
    use base64::Engine;
    if !crate::js::truthy(v) {
        return Ok(None);
    }
    match v {
        Value::Object(o) if o.len() == 1 && o.get("$b64").is_some_and(Value::is_string) => {
            base64::engine::general_purpose::STANDARD
                .decode(o["$b64"].as_str().unwrap_or(""))
                .map(Some)
                .map_err(|e| e.to_string())
        }
        Value::Array(a) => Ok(Some(a.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect())),
        Value::Object(o) => {
            let mut v: Vec<(usize, u8)> =
                o.iter().filter_map(|(k, x)| Some((k.parse().ok()?, x.as_u64().unwrap_or(0) as u8))).collect();
            v.sort();
            Ok(Some(v.into_iter().map(|(_, b)| b).collect()))
        }
        _ => Ok(Some(Vec::new())),
    }
}
