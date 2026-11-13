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
use std::sync::{Arc, Mutex, MutexGuard};

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
    /// the game folder and language folder the installer was made for
    made_for: (Option<PathBuf>, String),
}

/// The owner: the state, and the shell it answers through.
pub struct Owner {
    pub opts: Options,
    pub shell: Arc<dyn Shell>,
    core: Mutex<Core>,
    log: Mutex<Vec<String>>,
    started: AtomicBool,
}

pub type R = Result<Value, String>;

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
        let mut inst = Installer::new(now.0.clone(), &now.1).with_user_data(user_data);
        inst.journal_dir = Some(user_data.join("tx"));
        self.installer = inst;
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
        let mut installer = Installer::new(made_for.0.clone(), &made_for.1).with_user_data(&ud);
        installer.journal_dir = Some(tx);
        let schema = SchemaService::new(&ud, true);
        let core = Core {
            settings,
            library,
            installer,
            schema,
            upkeep,
            remote,
            launch_counted: false,
            presence_view: "catalog".into(),
            made_for,
        };
        let owner = Arc::new(Owner {
            opts,
            shell,
            core: Mutex::new(core),
            log: Mutex::new(lines),
            started: AtomicBool::new(false),
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
                &mut |_, _| Ok(()),
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
        crate::owner_settings::handle(self, channel, args)
    }

    /// Every channel the owner answers.
    pub fn channels() -> Vec<&'static str> {
        crate::owner_settings::CHANNELS.to_vec()
    }
}

/// `args[i]`, or null.
pub fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}
