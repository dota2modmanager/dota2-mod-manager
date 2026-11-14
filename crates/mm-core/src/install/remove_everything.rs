//! Taking out everything the app put into the game, in one go (src/remove-everything.ts): for the
//! uninstaller, and for the button in Settings that gives the game back the way Steam gave it.
//! Everything goes through the code the app uses day to day, so a mod comes out the way removing
//! it from My mods would and the patch the way the safe-mode switch would.

use serde_json::Value;

use crate::installer::Installer;
use crate::library::Library;
use crate::schema_service::{Ctx, SchemaService};
use crate::settings::Settings;

/// What to take out.
#[derive(Debug, Clone, Copy)]
pub struct What {
    /// put gameinfo and the signatures back, when safe mode was turned off
    pub revert: bool,
    /// take every mod out of the game folder and off the list
    pub mods: bool,
    /// the anti-cheat notice pak too (the uninstaller)
    pub notice: bool,
}

/// How one mod comes out; None is the installer's own way. The app wraps it in a file transaction.
pub type RemoveOne<'a> = &'a mut dyn FnMut(&Installer, &mut Library, &Value) -> Result<(), String>;

fn take_out(inst: &Installer, lib: &mut Library, rec: &Value) -> Result<(), String> {
    if rec.get("kind").and_then(Value::as_str) == Some("pack") {
        inst.remove_pack_fully(rec)?;
    } else {
        let files = crate::overlays::files_of(rec.get("files").unwrap_or(&Value::Null));
        let id = rec.get("id").and_then(Value::as_str);
        inst.remove(&files, id, rec.get("enabled") != Some(&Value::Bool(false)))?;
    }
    lib.remove_record(rec.get("id").unwrap_or(&Value::Null), None).map_err(|e| e.to_string())
}

/// Take out what was asked for, carrying on past a mod that will not come out: one line per thing
/// that could not be removed, and how many mods went. The patch goes first, since reverting reads
/// the backups in the app's own folder, and the mods before the uninstaller wipes that folder,
/// since the manifest is the only record of which files in the game were ours.
pub fn remove_everything(
    inst: &Installer,
    lib: &mut Library,
    settings: &mut Settings,
    schema: &mut SchemaService,
    remove_one: Option<RemoveOne>,
    what: What,
) -> (Vec<String>, usize) {
    let mut errors = Vec::new();
    let mut removed = 0;
    if what.revert && settings.get("schemaPatch").is_some_and(crate::js::truthy) {
        let (mut log, mut deployed) = (|_: String| {}, |_| {});
        let mut ctx = Ctx { inst, lib, settings, bases: None, log: &mut log, on_deployed: &mut deployed };
        // the switch answers {error} rather than failing, and an answer is not a thing left behind
        schema.set_enabled(&mut ctx, false);
    }
    if what.mods {
        let mut own = take_out;
        let one: RemoveOne = match remove_one {
            Some(f) => f,
            None => &mut own,
        };
        for rec in lib.list().to_vec() {
            match one(inst, lib, &rec) {
                Ok(()) => removed += 1,
                Err(e) => {
                    let name = rec.get("name").map_or("undefined".into(), crate::js::string);
                    errors.push(format!("{name}: {e}"));
                }
            }
        }
    }
    // the notice names this app's switch, so it goes with the app; while the app stays, it would
    // only be written back on the next start
    if what.notice && settings.get("dotaGamePath").is_some_and(crate::js::truthy) {
        match inst.lang_folder() {
            Ok(dir) => {
                crate::notice_text::remove_notice(&dir);
            }
            Err(e) => errors.push(format!("notice: {e}")),
        }
    }
    (errors, removed)
}
