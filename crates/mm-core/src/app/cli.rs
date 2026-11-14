//! The command line (issue #436, src/cli.ts): put a preset on, list the mods, or switch them all
//! off, with no window. For scripts, LAN setups and Steam Deck desktop mode.
//!
//!   dota2-mod-manager --apply "d2mm://preset/..."   install the preset's mods and put it on
//!   dota2-mod-manager --list                        every mod in My mods, on or off
//!   dota2-mod-manager --disable-all                 every mod and look off, kept in My mods
//!
//! `--headless` may go along with any of them and changes nothing: none of them opens a window.
//! The run goes through the owner the window talks to (owner_presets' flow, the installer, the
//! library), so the write jail, the file journal and the remote switches hold here too. The owner's
//! start puts the game folder right first (game_upkeep), the way a window would find it.
//!
//! Exit codes: 0 done; 1 failed, one line on stderr; 2 done without some of it, one line per thing
//! left out; 3 the app is already open; 64 a command line it does not understand. The shell
//! (src-tauri/src/command_line.rs) answers 3 itself, before anything is started.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::build_undo::touches_schema;
use crate::file_tx::FileTx;
use crate::js::{string, truthy};
use crate::overlays::files_of;
use crate::owner::{Options, Owner, Shell};

/// Exit code: done.
pub const OK: i32 = 0;
/// Exit code: failed, one line on stderr.
pub const FAILED: i32 = 1;
/// Exit code: done without some of it, one stderr line per thing left out.
pub const PARTLY: i32 = 2;
/// Exit code: the app is already open and holds the library.
pub const BUSY: i32 = 3;
/// Exit code: a command line it does not understand.
pub const USAGE: i32 = 64;

const USAGE_LINE: &str = "usage: --apply <d2mm://preset/... link> | --list | --disable-all [--headless]";

/// What a second copy started with a command says before it goes.
pub const BUSY_LINE: &str = "Dota 2 Mod Manager is already open: close it, then run the command again";

/// What the command line asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Apply(String),
    List,
    DisableAll,
}

/// A command line read: a command to run, or why it cannot be run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Parsed {
    Run(Command),
    Usage(String),
}

/// The command in a command line, None when it holds none (an ordinary start), or why it cannot
/// be run. Everything else on the line (--write-jail, --user-data-dir, a clicked d2mm:// link) is
/// left to whoever reads it.
pub fn command(argv: &[String]) -> Option<Parsed> {
    let mut found = Vec::new();
    let mut headless = false;
    let mut i = 0;
    while i < argv.len() {
        let a = argv[i].as_str();
        if a == "--list" {
            found.push(Command::List);
        } else if a == "--disable-all" {
            found.push(Command::DisableAll);
        } else if a == "--headless" {
            headless = true;
        } else if a == "--apply" || a.starts_with("--apply=") {
            let link = match a.strip_prefix("--apply=") {
                Some(l) => Some(l),
                None => {
                    i += 1;
                    argv.get(i).map(String::as_str)
                }
            };
            match link.filter(|l| !l.is_empty() && !l.starts_with("--")) {
                Some(l) => found.push(Command::Apply(l.to_string())),
                None => return Some(Parsed::Usage(format!("--apply needs a preset link. {USAGE_LINE}"))),
            }
        }
        i += 1;
    }
    match found.len() {
        0 if headless => Some(Parsed::Usage(format!("--headless alone has nothing to do. {USAGE_LINE}"))),
        0 => None,
        1 => found.pop().map(Parsed::Run),
        _ => Some(Parsed::Usage(format!("one command at a time. {USAGE_LINE}"))),
    }
}

/// Where the run's lines go: stdout for answers, stderr for what went wrong.
pub trait Io: Send + Sync {
    fn out(&self, line: &str);
    fn err(&self, line: &str);
}

/// The process's own stdout and stderr.
pub struct Stdio;

impl Io for Stdio {
    fn out(&self, line: &str) {
        use std::io::Write;
        let mut o = std::io::stdout().lock();
        let _ = writeln!(o, "{line}");
        let _ = o.flush();
    }
    fn err(&self, line: &str) {
        use std::io::Write;
        let _ = writeln!(std::io::stderr().lock(), "{line}");
    }
}

/// The owner's shell with no window: what the window shows on its progress bar is said as it
/// happens, and anything that needs a window is refused.
pub struct CliShell(pub Arc<dyn Io>);

impl Shell for CliShell {
    fn event(&self, channel: &str, args: Vec<Value>) {
        let Some(evt) = args.first().filter(|_| channel == "progress") else { return };
        if evt.get("type").and_then(Value::as_str) == Some("stage") {
            self.0.out(&format!("{}: {}", text(evt.get("label")), text(evt.get("stage"))));
        }
    }

    fn request(&self, method: &str, _args: Vec<Value>) -> Result<Value, String> {
        match method {
            // a link routed to a window that is not there: nothing to show
            "win.show" | "win.focus" => Ok(Value::Null),
            _ => Err(format!("{method}: there is no window on the command line")),
        }
    }
}

/// `${x}` in a JavaScript template: a missing value is "undefined".
fn text(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(v) => string(v),
    }
}

/// The first line of an error, as the window's toast would lead with it.
fn first_line(e: &str) -> &str {
    e.split('\n').next().unwrap_or("")
}

/// The error of an answer, when it is one.
fn error_of(v: &Value) -> Option<String> {
    v.get("error").filter(|e| truthy(e)).map(|e| text(Some(e)))
}

/// Run one command to the end over a started owner, the item table included.
/// Returns the exit code.
pub fn run(o: &Owner, cmd: &Command, io: &dyn Io) -> i32 {
    let finish = |errors: &[String]| {
        o.settled();
        for e in errors {
            io.err(e);
        }
        if errors.is_empty() {
            OK
        } else {
            PARTLY
        }
    };
    match cmd {
        Command::List => {
            let c = o.core();
            for r in c.library.list() {
                let style = r.get("styleLabel").filter(|s| truthy(s)).map(|s| format!(" ({})", text(Some(s))));
                let on = if r.get("enabled") == Some(&Value::Bool(false)) { "off" } else { "on " };
                io.out(&format!(
                    "{on}\t{}\t{}{}",
                    text(r.get("categoryId")),
                    text(r.get("name")),
                    style.unwrap_or_default()
                ));
            }
            OK
        }
        Command::DisableAll => {
            let (mut errors, mut changed, mut schema) = (Vec::new(), 0, false);
            {
                let mut c = o.core();
                let records: Vec<Value> = c.library.list().to_vec();
                for rec in records.iter().filter(|r| r.get("enabled") != Some(&Value::Bool(false))) {
                    let id = rec.get("id").cloned().unwrap_or(Value::Null);
                    let files = files_of(rec.get("files").unwrap_or(&Value::Null));
                    let crate::owner::Core { installer, library, .. } = &mut *c;
                    // the files and the record go together, or neither does (mods:setEnabled)
                    let done = FileTx::run(installer.journal_dir.as_deref(), installer.tx_log(), |tx| {
                        installer.set_enabled(&files, false, id.as_str())?;
                        library.set_enabled(&id, false, Some(tx)).map_err(|e| e.to_string())?;
                        Ok::<(), String>(())
                    });
                    match done {
                        Ok(()) => {
                            schema |= touches_schema(rec)
                                || rec.get("categoryId").and_then(Value::as_str) == Some("cosmetic");
                            changed += 1;
                        }
                        Err(e) => errors.push(format!("{}: {e}", text(rec.get("name")))),
                    }
                }
            }
            if schema {
                drop(o.refresh_schema_in_background());
            }
            io.out(&format!("switched off: {changed}"));
            finish(&errors)
        }
        Command::Apply(link) => {
            // the remote switch alone: there is no game watch here, as there was none under Electron
            let stop = {
                let c = o.core();
                let lang = crate::feature_gate::note_lang(&Value::Object(c.settings.all()));
                crate::feature_gate::gate(false, || c.remote.feature("install", lang))
            };
            if let Some(stop) = stop {
                io.err(&error_of(&stop).unwrap_or_default());
                return FAILED;
            }
            let parked = crate::presets_service::import_preset_link(&mut o.core().library, &json!(link));
            if let Some(e) = error_of(&parked) {
                io.err(&e);
                return FAILED;
            }
            let preset = parked.get("preset").cloned().unwrap_or(Value::Null);
            let r = crate::owner_presets::flow(o, &preset, false);
            if let Some(e) = error_of(&r) {
                io.err(first_line(&e));
                return FAILED;
            }
            io.out(&format!("applied \"{}\": {} mods", text(preset.get("name")), text(r.get("installed"))));
            let errors: Vec<String> = r
                .get("errors")
                .and_then(Value::as_array)
                .map(|a| a.iter().map(|e| text(Some(e))).collect())
                .unwrap_or_default();
            finish(&errors)
        }
    }
}

/// A command line's command run start to end: a line it cannot read exits at once, anything else
/// starts the owner (the game folder put right first) and runs. A panic is a failure with its
/// message on stderr, as a thrown error was.
pub fn main(parsed: Parsed, opts: Options, io: Arc<dyn Io>) -> i32 {
    let cmd = match parsed {
        Parsed::Usage(why) => {
            io.err(&why);
            return USAGE;
        }
        Parsed::Run(cmd) => cmd,
    };
    let shell_io = io.clone();
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let o = Owner::start(opts, Arc::new(CliShell(shell_io)));
        o.diag(&format!("command line: {cmd:?}"));
        run(&o, &cmd, &*io)
    }));
    match res {
        Ok(code) => code,
        Err(p) => {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "the command stopped".into());
            io.err(first_line(&msg));
            FAILED
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn argv(a: &[&str]) -> Vec<String> {
        ["dota2-mod-manager.exe", "--write-jail=sandbox", "--user-data-dir=x"]
            .iter()
            .chain(a)
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn a_command_line_names_one_command_and_an_ordinary_start_names_none() {
        assert_eq!(command(&argv(&[])), None);
        assert_eq!(command(&argv(&["d2mm://preset/abc"])), None, "a clicked link is the window's, not a command");
        assert_eq!(command(&argv(&["--list"])), Some(Parsed::Run(Command::List)));
        assert_eq!(command(&argv(&["--disable-all", "--headless"])), Some(Parsed::Run(Command::DisableAll)));
        assert_eq!(
            command(&argv(&["--apply", "d2mm://preset/abc"])),
            Some(Parsed::Run(Command::Apply("d2mm://preset/abc".into())))
        );
        assert_eq!(
            command(&argv(&["--apply=https://dota2modmanager.com/p/#abc"])),
            Some(Parsed::Run(Command::Apply("https://dota2modmanager.com/p/#abc".into())))
        );
    }

    #[test]
    fn a_command_line_it_cannot_run_says_why_with_the_usage() {
        for a in
            [&["--apply"][..], &["--apply", "--list"], &["--apply="], &["--list", "--disable-all"], &["--headless"]]
        {
            match command(&argv(a)) {
                Some(Parsed::Usage(why)) => assert!(why.contains("usage: --apply"), "{a:?}: {why}"),
                other => panic!("{a:?}: {other:?}"),
            }
        }
        let Some(Parsed::Usage(why)) = command(&argv(&["--apply"])) else { unreachable!() };
        assert_eq!(why, format!("--apply needs a preset link. {USAGE_LINE}"));
    }

    #[derive(Default)]
    struct Lines(Mutex<(Vec<String>, Vec<String>)>);
    impl Io for Lines {
        fn out(&self, line: &str) {
            self.0.lock().unwrap().0.push(line.into());
        }
        fn err(&self, line: &str) {
            self.0.lock().unwrap().1.push(line.into());
        }
    }
    impl Lines {
        fn take(&self) -> (Vec<String>, Vec<String>) {
            std::mem::take(&mut *self.0.lock().unwrap())
        }
    }

    fn opts(ud: &std::path::Path) -> Options {
        Options {
            user_data: ud.to_path_buf(),
            app_version: "9.9.9".into(),
            app_root: ud.to_path_buf(),
            downloads: ud.to_path_buf(),
            uninstall: false,
            system_languages: None,
            find_game: Box::new(|| None),
            dota_running: Box::new(|| false),
            now: crate::net_fetch::now_ms,
        }
    }

    fn temp() -> std::path::PathBuf {
        let ud = std::env::temp_dir().join(format!("mm-cli-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        std::fs::write(ud.join("settings.json"), "{}").unwrap();
        ud
    }

    #[test]
    fn a_line_it_cannot_read_exits_64_before_anything_starts() {
        let io = Arc::new(Lines::default());
        let ud = std::env::temp_dir().join(format!("mm-cli-never-{}", uuid::Uuid::new_v4().simple()));
        assert_eq!(main(Parsed::Usage("why".into()), opts(&ud), io.clone()), USAGE);
        assert_eq!(io.take(), (vec![], vec!["why".to_string()]));
        assert!(!ud.exists(), "no owner was started, so nothing was written");
    }

    #[test]
    fn list_says_every_mod_and_disable_all_switches_them_off_and_keeps_them() {
        let ud = temp();
        {
            let mut lib = crate::library::Library::new(&ud);
            lib.add(&json!({ "categoryId": "heroes", "name": "Juggernaut", "styleLabel": "Red", "files": [] }), None)
                .unwrap();
            let off = lib.add(&json!({ "categoryId": "terrain", "name": "Desert", "files": [] }), None).unwrap();
            lib.set_enabled(&off["id"], false, None).unwrap();
            lib.add(&json!({ "categoryId": "hud", "name": "Clean HUD", "files": [] }), None).unwrap();
        }
        let io = Arc::new(Lines::default());
        assert_eq!(main(Parsed::Run(Command::List), opts(&ud), io.clone()), OK);
        let (out, err) = io.take();
        assert_eq!(out, ["on \theroes\tJuggernaut (Red)", "off\tterrain\tDesert", "on \thud\tClean HUD"]);
        assert!(err.is_empty(), "{err:?}");

        assert_eq!(main(Parsed::Run(Command::DisableAll), opts(&ud), io.clone()), OK);
        assert_eq!(io.take(), (vec!["switched off: 2".to_string()], vec![]));
        let lib = crate::library::Library::new(&ud);
        assert_eq!(lib.list().len(), 3, "kept in My mods");
        assert!(lib.list().iter().all(|r| r["enabled"] == json!(false)));

        // nothing left on: nothing to do, and still done
        assert_eq!(main(Parsed::Run(Command::DisableAll), opts(&ud), io.clone()), OK);
        assert_eq!(io.take().0, ["switched off: 0"]);
        let _ = std::fs::remove_dir_all(ud);
    }

    #[test]
    fn a_link_it_cannot_read_fails_with_one_line_and_parks_nothing() {
        let ud = temp();
        let io = Arc::new(Lines::default());
        assert_eq!(main(Parsed::Run(Command::Apply("d2mm://preset/garbage".into())), opts(&ud), io.clone()), FAILED);
        let (out, err) = io.take();
        assert!(out.is_empty(), "{out:?}");
        assert_eq!(err.len(), 1, "{err:?}");
        assert!(crate::library::Library::new(&ud).list_presets().is_empty());
        let _ = std::fs::remove_dir_all(ud);
    }

    #[test]
    fn the_progress_bar_is_said_as_it_happens_and_a_window_is_refused() {
        let io = Arc::new(Lines::default());
        let shell = CliShell(io.clone());
        shell.event("progress", vec![json!({ "type": "stage", "label": "Juggernaut", "stage": "установка" })]);
        shell.event("progress", vec![json!({ "type": "download", "label": "Juggernaut", "done": 1 })]);
        shell.event("mod-link", vec![json!({ "type": "stage" })]);
        assert_eq!(io.take().0, ["Juggernaut: установка"]);
        assert!(shell.request("win.show", vec![]).is_ok());
        assert!(shell.request("dialog.open", vec![]).is_err());
    }
}
