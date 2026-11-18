//! The item table and the search-path patch, kept in step with the library and the installed game
//! (src/schema-service.ts):
//!   - the table is ALWAYS rebuilt from the installed game's own items_game.txt, so it can never
//!     be the stale copy a mod happened to ship;
//!   - a mod's changes live in the library record (record.schema), never in its VPK;
//!   - nothing is written to the game unless the user turned the patch on; without it, the
//!     item builder's picks go as a pak of files in the language folder.
//!
//! The service holds what lives between builds (the picks built once, the game's table read once
//! per game build); the installer, the library and the settings are handed to each call, so the
//! shell decides how they are shared with its build thread (`background_builds.rs`).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::arcana_bases::BaseSource;
use crate::installer::Installer;
use crate::item_builder_everyone::{everyone_wears_by_hero, SchemaPatch};
use crate::item_builder_everyone_budget::{heroes_by_recency, within_budget, EVERYONE_ENTRY_BUDGET};
use crate::item_files_service::ItemFilesPak;
use crate::library::Library;
use crate::patcher;
use crate::schema_build::{is_item_pick, TableBuild};
use crate::schema_deploy;
use crate::schema_merge::{Conflict, Patch};
use crate::settings::Settings;

/// The app's own code, as a stamp: a build the item builder made is only as right as the code
/// that made it, so a new build of the app builds the picks again. The TypeScript hashes its
/// sources at start; here the crate's version and, from CI, the commit say the same.
pub fn builder_stamp() -> String {
    match option_env!("MM_BUILD_SHA") {
        Some(sha) if !sha.is_empty() => format!("rs-{}-{}", env!("CARGO_PKG_VERSION"), &sha[..sha.len().min(12)]),
        _ => format!("rs-{}", env!("CARGO_PKG_VERSION")),
    }
}

/// What a build of the table answers.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refreshed {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patches: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflicts: Option<Vec<Conflict>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<usize>,
    /// stopped before it wrote, for a newer build that did
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded: Option<bool>,
    /// stopped by Cancel on the bar
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
}

fn failed(e: impl ToString) -> Refreshed {
    Refreshed { ok: false, error: Some(e.to_string()), ..Default::default() }
}

/// What heal did; `rebuild` asks the caller for a build in the background (`background: true`).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Healed {
    pub ok: bool,
    pub healed: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip)]
    pub rebuild: bool,
}

/// What a call is handed: the app's state, and where its news goes.
pub struct Ctx<'a> {
    pub inst: &'a Installer,
    pub lib: &'a mut Library,
    pub settings: &'a mut Settings,
    pub bases: Option<&'a dyn BaseSource>,
    pub log: &'a mut dyn FnMut(String),
    /// the paths, lowercased, the written table's picks fill (none once it is taken off)
    pub on_deployed: &'a mut dyn FnMut(HashSet<String>),
}

impl Ctx<'_> {
    fn game(&self) -> Option<PathBuf> {
        self.settings.get("dotaGamePath").and_then(Value::as_str).filter(|s| !s.is_empty()).map(PathBuf::from)
    }
    fn on(&self, key: &str) -> bool {
        self.settings.get(key).is_some_and(crate::js::truthy)
    }
    fn set(&mut self, key: &str, v: Value) -> Result<(), String> {
        self.settings.set(key, v).map_err(|e| e.to_string())
    }
    fn mods_off(&self) -> bool {
        self.inst.master_is_off().unwrap_or(false)
    }
    fn picks_on(&self) -> usize {
        self.lib.list().iter().filter(|r| r.get("enabled") != Some(&Value::Bool(false)) && is_item_pick(r)).count()
    }
}

/// The game's table and the stamp of its content.
type Base = Arc<(Vec<u8>, String)>;

/// The item table's service: the picks built once, the game's table read once per game build.
pub struct SchemaService {
    pub backup_dir: PathBuf,
    table: TableBuild,
    /// the picks without the table: a pak in the language folder (none: picks wait for the table)
    files: Option<ItemFilesPak>,
    cache: Option<(String, Base)>,
    /// one more for every build begun: a build made meanwhile by another is not written over it
    epoch: u64,
}

/// What a build is made from, as the app's state said when it began. Asked again before the
/// write: a change meanwhile that asked no build of its own still is not written over.
#[derive(PartialEq)]
pub struct Inputs {
    mods_off: bool,
    schema_patch: bool,
    everyone: bool,
    excluded: HashSet<String>,
    picks: usize,
    records: Vec<Value>,
}

impl Inputs {
    fn of(ctx: &Ctx) -> Self {
        let excluded = ctx
            .settings
            .get("everyoneExcluded")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default();
        Inputs {
            mods_off: ctx.mods_off(),
            schema_patch: ctx.on("schemaPatch"),
            everyone: ctx.on("everyoneWearsMine"),
            excluded,
            picks: ctx.picks_on(),
            records: ctx.lib.list().to_vec(),
        }
    }
}

/// A build begun: what it needs to be made away from the app's state.
pub struct Job {
    epoch: u64,
    game: PathBuf,
    base: Base,
    table: TableBuild,
    files: Option<ItemFilesPak>,
    inputs: Inputs,
}

/// What `begin` answers: a build to make, or one already done.
pub enum Begun {
    Done(Refreshed),
    Job(Box<Job>),
}

/// A build made, for `finish` to write.
pub struct Made {
    job: Box<Job>,
    out: Result<Making, String>,
}

enum Making {
    Superseded,
    /// nothing to put in the table: it is taken off
    Nothing {
        left_out: Option<Vec<String>>,
    },
    Files {
        filled: HashSet<String>,
    },
    Table {
        ready: Box<schema_deploy::Prepared>,
        filled: HashSet<String>,
        left_out: Option<Vec<String>>,
    },
}

impl SchemaService {
    pub fn new(user_data_dir: &Path, with_files: bool) -> Self {
        SchemaService {
            backup_dir: user_data_dir.join("backups").join("patch"),
            table: TableBuild::new(),
            files: with_files.then(ItemFilesPak::default),
            cache: None,
            epoch: 0,
        }
    }

    fn stamp_of(table: Option<&str>) -> Option<String> {
        table.map(|t| format!("{t}|{}", builder_stamp()))
    }

    /// The game's own table, read once per build of the game: a stat() of its paks notices one.
    pub fn vanilla(&mut self, game: &Path) -> Result<Base, String> {
        let stamp = crate::pak_stamp::game_schema_stamp(game).ok();
        if let (Some(s), Some((have, base))) = (&stamp, &self.cache) {
            if s == have {
                return Ok(base.clone());
            }
        }
        let base: Base = Arc::new(crate::schema::read_game_schema(game)?);
        if let Some(s) = stamp {
            self.cache = Some((s, base.clone()));
        } else {
            self.cache = None;
        }
        self.table.forget();
        Ok(base)
    }

    fn drop_table(ctx: &mut Ctx, game: &Path) -> Result<Refreshed, String> {
        schema_deploy::undeploy(game, patcher::FOLDER).map_err(|e| e.to_string())?;
        ctx.set("schemaStamp", Value::Null)?;
        ctx.set("schemaPending", json!(false))?;
        (ctx.on_deployed)(HashSet::new());
        Ok(Refreshed { ok: true, deployed: Some(false), patches: Some(0), ..Default::default() })
    }

    /// Rebuild and write the table, or remove it when nothing needs one. `stop`: a newer build took
    /// over (asked before the write); `progress`: (done, total) of the picks built anew. The shell's
    /// build in the background takes the three steps apart (`begin`, `make`, `finish`) to hold the
    /// app's state only for the first and the last.
    pub fn refresh(
        &mut self,
        ctx: &mut Ctx,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Refreshed {
        let job = match self.begin(ctx) {
            Begun::Done(r) => return r,
            Begun::Job(job) => job,
        };
        let made = Self::make(job, ctx.bases, stop, progress, ctx.log);
        self.finish(ctx, made, stop)
    }

    /// A build's first step, holding the app's state: what it builds from, taken. A build with
    /// nothing to make (the table only taken off) is done here.
    pub fn begin(&mut self, ctx: &mut Ctx) -> Begun {
        let Some(game) = ctx.game() else {
            return Begun::Done(Refreshed { ok: false, reason: Some("no-game-path".into()), ..Default::default() });
        };
        // said before the build and unsaid when one writes: an app closed in between left the game a
        // change behind the library, and the next start did not notice
        if let Err(e) = ctx.set("schemaPending", json!(true)) {
            return Begun::Done(failed(e));
        }
        self.epoch += 1;
        let run = (|| -> Result<Result<Box<Job>, Refreshed>, String> {
            // the master switch renames the language folder's paks; the table, in a folder of its
            // own, goes too, and the switch builds it again
            if ctx.mods_off() {
                return Self::drop_table(ctx, &game).map(Err);
            }
            if !ctx.on("schemaPatch") {
                if self.files.is_none() || ctx.picks_on() == 0 {
                    if self.files.is_some() {
                        ItemFilesPak::clear(ctx.inst, ctx.lib)?;
                    }
                    return Self::drop_table(ctx, &game).map(Err);
                }
            } else if self.files.is_some() {
                ItemFilesPak::clear(ctx.inst, ctx.lib)?;
            }
            let base = self.vanilla(&game)?;
            // taken after the pak of picks went, which changes the library
            let inputs = Inputs::of(ctx);
            Ok(Ok(Box::new(Job {
                epoch: self.epoch,
                game,
                base,
                table: std::mem::take(&mut self.table),
                files: self.files.take(),
                inputs,
            })))
        })();
        match run {
            Ok(Ok(job)) => Begun::Job(job),
            Ok(Err(done)) => Begun::Done(done),
            Err(e) => Begun::Done(failed(e)),
        }
    }

    /// The slow step: the picks built, the table merged and packed. It reads the game and nothing
    /// of the app's state, so the shell runs it without holding that, and the window keeps
    /// answering meanwhile.
    pub fn make(
        mut job: Box<Job>,
        bases: Option<&dyn BaseSource>,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(usize, usize),
        log: &mut dyn FnMut(String),
    ) -> Made {
        let out = Self::make_in(&mut job, bases, stop, progress, log);
        Made { job, out }
    }

    fn make_in(
        job: &mut Job,
        bases: Option<&dyn BaseSource>,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(usize, usize),
        log: &mut dyn FnMut(String),
    ) -> Result<Making, String> {
        let Job { game, base, inputs, table, files, .. } = job;
        let records = &inputs.records;
        let built = table.build(&base.0, game, records, bases, progress, log)?;
        if !inputs.schema_patch {
            let ix =
                crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let files = files.as_mut().expect("begin keeps the pak only with picks to put in it");
            let filled = files.build(&built, &read, inputs.picks)?;
            return Ok(Making::Files { filled });
        }
        let mut list: Vec<SchemaPatch> = built
            .list
            .iter()
            .map(|p| SchemaPatch {
                id: p.id.clone(),
                block: p.block.clone(),
                assets: p.assets.clone().unwrap_or_default(),
                source: p.source.clone(),
            })
            .collect();
        // every other player of the hero in the user's look, when asked for
        let mut left_out = None;
        if inputs.everyone {
            let (more, left) = Self::everyone(&inputs.excluded, &base.0, &list, &built.beneath, records, game, log)?;
            list.extend(more);
            left_out = Some(left);
        }
        if list.is_empty() {
            return Ok(Making::Nothing { left_out });
        }
        if stop() {
            return Ok(Making::Superseded);
        }
        let patches: Vec<Patch> =
            list.iter().map(|p| Patch { id: p.id.clone(), block: p.block.clone(), source: p.source.clone() }).collect();
        let mut assets: Vec<&[crate::vpk::Entry]> = list.iter().map(|p| p.assets.as_slice()).collect();
        assets.push(&built.beneath);
        let ready = schema_deploy::prepare(&patches, &assets, (&base.0, &base.1))?;
        // with the bases' files, which the arcana window covered with Valve's: a plain body
        let filled =
            list.iter().flat_map(|p| p.assets.iter()).chain(&built.beneath).map(|e| e.path().to_lowercase()).collect();
        Ok(Making::Table { ready: Box::new(ready), filled, left_out })
    }

    /// The last step, holding the app's state again: what was built goes back, and is written
    /// unless a newer build took over or what it was built from changed meanwhile.
    pub fn finish(&mut self, ctx: &mut Ctx, made: Made, stop: &dyn Fn() -> bool) -> Refreshed {
        let Made { job, out } = made;
        let Job { epoch, game, base, table, files, inputs } = *job;
        // another build began while this one was made: it has the newer picks, and writes
        let current = epoch == self.epoch;
        if current {
            self.table = table;
            self.files = files;
            // the game was read anew meanwhile: a pick's files can change with its block the same
            if self.cache.as_ref().map(|c| &c.1 .1) != Some(&base.1) {
                self.table.forget();
            }
        }
        let making = match out {
            Ok(m) => m,
            Err(e) => return failed(e),
        };
        if matches!(making, Making::Superseded) || !current || stop() || Inputs::of(ctx) != inputs {
            return Refreshed { ok: true, superseded: Some(true), ..Default::default() };
        }
        let run = (|| -> Result<Refreshed, String> {
            match making {
                Making::Superseded => Ok(Refreshed { ok: true, superseded: Some(true), ..Default::default() }),
                Making::Files { filled } => {
                    // the table's, if one was up: the pak takes over after it
                    let out = Self::drop_table(ctx, &game)?;
                    if let Some(files) = self.files.as_mut() {
                        files.commit(ctx.inst, ctx.lib, ctx.log)?;
                    }
                    ctx.set("schemaStamp", json!(Self::stamp_of(Some(&base.1))))?;
                    (ctx.on_deployed)(filled);
                    Ok(Refreshed { deployed: Some(true), patches: Some(inputs.picks), ..out })
                }
                Making::Nothing { left_out } => {
                    if let Some(left) = left_out {
                        ctx.set("everyoneLeftOut", json!(left))?;
                    }
                    Self::drop_table(ctx, &game)
                }
                Making::Table { ready, filled, left_out } => {
                    if let Some(left) = left_out {
                        ctx.set("everyoneLeftOut", json!(left))?;
                    }
                    schema_deploy::write(&game, patcher::FOLDER, &ready.buf)?;
                    let res = ready.deployed;
                    ctx.set("schemaStamp", json!(Self::stamp_of(Some(&res.stamp))))?;
                    ctx.set("schemaPending", json!(false))?;
                    (ctx.on_deployed)(filled);
                    Ok(Refreshed {
                        ok: true,
                        deployed: Some(true),
                        patches: Some(res.applied.len()),
                        missing: Some(res.missing),
                        conflicts: Some(res.conflicts),
                        bytes: Some(res.bytes),
                        ..Default::default()
                    })
                }
            }
        })();
        run.unwrap_or_else(failed)
    }

    /// Everybody's look for every hero the user built but those they left out, the one built most
    /// lately first, as much of it as the game can take (crate::item_builder_everyone_budget). Who
    /// did not fit comes back too, for `everyoneLeftOut` in Settings.
    fn everyone(
        excluded: &HashSet<String>,
        text: &[u8],
        own: &[SchemaPatch],
        beneath: &[crate::vpk::Entry],
        records: &[Value],
        game: &std::path::Path,
        log: &mut dyn FnMut(String),
    ) -> Result<(Vec<SchemaPatch>, Vec<String>), String> {
        let heroes: Vec<String> = heroes_by_recency(records).into_iter().filter(|h| !excluded.contains(h)).collect();
        if heroes.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }
        let ix =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        let read = |p: &str| ix.read(p).ok().flatten();
        let all = everyone_wears_by_hero(text, own, beneath, &read, Some(&heroes)).map_err(|e| e.to_string())?;
        let kept = within_budget(all, own, beneath, &heroes, EVERYONE_ENTRY_BUDGET);
        if !kept.left.is_empty() {
            log(format!(
                "schema: my look on everyone left out {} hero(es) to stay under the game's limit: {}",
                kept.left.len(),
                kept.left.join(", ")
            ));
        }
        Ok((kept.patches, kept.left))
    }

    /// A Dota update overwrites the patched gameinfo and moves the item table underneath our
    /// build: put both right. Runs on startup and before launching the game. With `background`,
    /// a table to build is left to the caller (`rebuild`), not built here.
    pub fn heal(&mut self, ctx: &mut Ctx, background: bool) -> Healed {
        let Some(game) = ctx.game() else { return Healed { ok: true, ..Default::default() } };
        let mut out = Healed { ok: true, ..Default::default() };
        let run = (|| -> Result<(), String> {
            if !ctx.on("schemaPatch") {
                // a Dota update reaches the picks' pak as it reaches the table
                if self.files.is_some() && ctx.picks_on() > 0 && !ctx.mods_off() {
                    let stamp = Self::stamp_of(Some(&self.vanilla(&game)?.1));
                    if json!(stamp) != ctx.settings.get("schemaStamp").cloned().unwrap_or(Value::Null) {
                        out.rebuild = true;
                    }
                }
                // safe mode still needs the game's own file to be the one Valve signed
                if patcher::state(&game, Some(patcher::FOLDER))?.vanilla_ok {
                    return Ok(());
                }
                patcher::revert(&game, Some(patcher::FOLDER), &self.backup_dir)?;
                if patcher::state(&game, Some(patcher::FOLDER))?.vanilla_ok {
                    out.healed.push("vanilla");
                }
                return Ok(());
            }
            let st = patcher::state(&game, Some(patcher::FOLDER))?;
            if !st.patched || st.outdated || (st.signable && !st.signed) {
                patcher::apply(&game, patcher::FOLDER, &self.backup_dir)?;
                out.healed.push("patch");
            }
            if schema_deploy::sweep_unfinished(&game, patcher::FOLDER, std::process::id()) > 0 {
                (ctx.log)("schema: a write another run left unfinished was taken away".into());
            }
            let stamp = Self::stamp_of(Some(&crate::schema::read_game_schema(&game)?.1));
            if json!(stamp) != ctx.settings.get("schemaStamp").cloned().unwrap_or(Value::Null)
                || !schema_deploy::is_deployed(&game, patcher::FOLDER)
                || ctx.on("schemaPending")
            {
                if background {
                    out.rebuild = true;
                } else {
                    let r = self.refresh(ctx, &|| false, &mut |_, _| {});
                    if let Some(e) = r.error {
                        (ctx.log)(format!("schema: the build after the repair failed: {e}"));
                    }
                }
                out.healed.push("schema");
            }
            Ok(())
        })();
        if let Err(e) = run {
            out.ok = false;
            out.error = Some(e);
        }
        out
    }

    /// Turn the patch on or off: the only place that edits files of the game install itself, and
    /// reached only from an explicit user action.
    pub fn set_enabled(&mut self, ctx: &mut Ctx, on: bool) -> Value {
        let Some(game) = ctx.game() else { return json!({ "error": "no-game-path" }) };
        let run = (|| -> Result<Value, String> {
            if on {
                patcher::apply(&game, patcher::FOLDER, &self.backup_dir)?;
                ctx.set("schemaPatch", json!(true))?;
                // refresh answers with its own ok, which is the one that counts
                return Ok(json!(self.refresh(ctx, &|| false, &mut |_, _| {})));
            }
            ctx.set("schemaPatch", json!(false))?;
            schema_deploy::undeploy(&game, patcher::FOLDER).map_err(|e| e.to_string())?;
            patcher::revert(&game, Some(patcher::FOLDER), &self.backup_dir)?;
            ctx.set("schemaStamp", Value::Null)?;
            Ok(json!({ "ok": true, "deployed": false }))
        })();
        run.unwrap_or_else(|e| json!({ "error": e }))
    }

    /// The picks the table puts on, for asking the arcana bases at start.
    pub fn picks(records: &[Value]) -> Vec<crate::arcana_bases::BasePick> {
        TableBuild::picks(records)
    }
}

/// Two mods changing the same item block DIFFERENTLY: only one of them can be in the built table,
/// so the library has to say so. Identical blocks are not a conflict at all.
pub fn conflicts(records: &[Value]) -> Vec<Value> {
    let flat = |s: &str| s.split(|c: char| c.is_whitespace()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    let mut order: Vec<String> = Vec::new();
    let mut by_id: HashMap<String, (Value, Vec<Value>, HashSet<String>)> = HashMap::new();
    for rec in records {
        if rec.get("enabled") == Some(&Value::Bool(false)) {
            continue;
        }
        let Some(blocks) = rec.get("schema").and_then(Value::as_array) else { continue };
        for d in blocks {
            let id = d.get("id").map(crate::js::string).unwrap_or_default();
            let entry = by_id.entry(id.clone()).or_insert_with(|| {
                order.push(id.clone());
                (d.get("name").cloned().unwrap_or(Value::Null), Vec::new(), HashSet::new())
            });
            entry.1.push(rec.get("name").cloned().unwrap_or(Value::Null));
            entry.2.insert(flat(&d.get("block").map(crate::js::string).unwrap_or_default()));
        }
    }
    order
        .into_iter()
        .filter_map(|id| {
            let (name, mods, texts) = by_id.remove(&id)?;
            (texts.len() > 1).then(|| json!({ "id": id, "name": name, "mods": mods }))
        })
        .collect()
}

/// The patch and the built table as Settings shows them; the patcher's own state is merged in.
pub fn state(inst: &Installer, lib: &Library, settings: &Settings, with_files: bool) -> Value {
    let _ = inst;
    let recs = lib.list();
    let on = |r: &&Value| r.get("enabled") != Some(&Value::Bool(false));
    let mods = recs
        .iter()
        .filter(on)
        .filter(|r| r.get("schema").and_then(Value::as_array).is_some_and(|a| !a.is_empty()))
        .count();
    let left = if with_files { ItemFilesPak::left(lib).as_array().map_or(0, Vec::len) } else { 0 };
    // a pick that goes as files asks nothing of the table, unless a part of it stays behind
    let picked = recs
        .iter()
        .filter(on)
        .filter(|r| r.get("categoryId").and_then(Value::as_str) == Some("cosmetic") && !(with_files && is_item_pick(r)))
        .count()
        + left;
    let mut out = Map::new();
    out.insert("enabled".into(), json!(settings.get("schemaPatch").is_some_and(crate::js::truthy)));
    out.insert("folder".into(), json!(patcher::FOLDER));
    out.insert("patched".into(), json!(false));
    out.insert("signed".into(), json!(false));
    out.insert("foreign".into(), Value::Null);
    out.insert("deployed".into(), json!(false));
    out.insert("stale".into(), json!(false));
    out.insert("mods".into(), json!(mods));
    out.insert("cosmeticsPicked".into(), json!(picked));
    out.insert("conflicts".into(), json!(conflicts(recs)));
    let Some(game) = settings.get("dotaGamePath").and_then(Value::as_str).filter(|s| !s.is_empty()).map(PathBuf::from)
    else {
        return Value::Object(out);
    };
    let run = (|| -> Result<(), String> {
        let st = patcher::state(&game, Some(patcher::FOLDER))?;
        if let Value::Object(m) = serde_json::to_value(st).map_err(|e| e.to_string())? {
            out.extend(m);
        }
        let deployed = schema_deploy::is_deployed(&game, patcher::FOLDER);
        out.insert("deployed".into(), json!(deployed));
        if deployed {
            let stamp = SchemaService::stamp_of(Some(&crate::schema::read_game_schema(&game)?.1));
            out.insert(
                "stale".into(),
                json!(json!(stamp) != settings.get("schemaStamp").cloned().unwrap_or(Value::Null)),
            );
        }
        Ok(())
    })();
    if let Err(e) = run {
        out.insert("error".into(), json!(e));
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    //! A build in three steps (begin, make, finish), as the shell runs it in the background: the
    //! state is let go while it is made, so what changed meanwhile must not be written over.

    use super::*;
    use crate::schema_deploy::SCHEMA_VPK;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn item(id: &str, name: &str) -> String {
        format!(
            "		\"{id}\"
		{{
			\"name\"		\"{name}\"
			\"prefab\"		\"default_item\"
		}}
"
        )
    }

    fn large(count: usize) -> Vec<u8> {
        let body: String = (1..=count).map(|i| item(&i.to_string(), &format!("Item {i}"))).collect();
        format!(
            "\"items_game\"
{{
	\"items\"
	{{
{body}	}}
}}
"
        )
        .into_bytes()
    }

    fn has(hay: &[u8], needle: &str) -> bool {
        hay.windows(needle.len()).any(|w| w == needle.as_bytes())
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            static N: AtomicUsize = AtomicUsize::new(0);
            let n = N.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("mm-schema-steps-{label}-{}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn game_with(label: &str, text: &[u8]) -> TempDir {
        let dir = TempDir::new(label);
        std::fs::create_dir_all(dir.0.join("dota")).unwrap();
        std::fs::write(dir.0.join("dota").join("pak01_dir.vpk"), schema_deploy::build_schema_vpk(text, &[])).unwrap();
        dir
    }

    /// The library, the settings and the installer of a game whose table is `text`, with the patch on.
    struct Setup {
        game: TempDir,
        _ud: TempDir,
        inst: crate::installer::Installer,
        lib: crate::library::Library,
        settings: crate::settings::Settings,
    }

    fn set_up(label: &str, text: &[u8]) -> Setup {
        let game = game_with(label, text);
        let ud = TempDir::new(&format!("{label}-ud"));
        let inst = crate::installer::Installer::new(Some(game.0.clone()), "russian");
        let lib = crate::library::Library::new(&ud.0);
        let mut settings = crate::settings::Settings::new(&ud.0);
        settings.set("dotaGamePath", json!(game.0.to_string_lossy())).unwrap();
        settings.set("schemaPatch", json!(true)).unwrap();
        Setup { game, _ud: ud, inst, lib, settings }
    }

    /// A mod in the library whose record changes item `id`.
    fn add_mod(lib: &mut crate::library::Library, name: &str, id: &str, new_name: &str) -> serde_json::Value {
        let rec = lib.add(&json!({ "name": name, "categoryId": "imported", "files": [] }), None).unwrap();
        let block = item(id, new_name);
        lib.update(&rec["id"], &json!({ "schema": [{ "id": id, "name": new_name, "block": block }] }), None).unwrap();
        rec
    }

    fn table_written(game: &Path) -> Option<Vec<u8>> {
        let pak = game.join(crate::patcher::FOLDER).join(SCHEMA_VPK);
        std::fs::read(pak).ok()
    }

    #[test]
    fn a_build_made_in_three_steps_writes_the_same_table_as_one_made_at_once() {
        use crate::schema_service::{Begun, Ctx, SchemaService};
        let mut s = set_up("steps", &large(1200));
        add_mod(&mut s.lib, "Renamer", "2", "Renamed");
        let mut svc = SchemaService::new(&s._ud.0, false);
        let (mut log, mut deployed) = (|_: String| {}, |_: std::collections::HashSet<String>| {});
        let mut ctx = Ctx {
            inst: &s.inst,
            lib: &mut s.lib,
            settings: &mut s.settings,
            bases: None,
            log: &mut log,
            on_deployed: &mut deployed,
        };
        let Begun::Job(job) = svc.begin(&mut ctx) else { panic!("a mod with a block is a build to make") };
        let made = SchemaService::make(job, None, &|| false, &mut |_, _| {}, &mut |_| {});
        let out = svc.finish(&mut ctx, made, &|| false);
        assert!(out.ok && out.deployed == Some(true), "{out:?}");
        assert_eq!(out.patches, Some(1));
        let pak = table_written(&s.game.0).expect("the table was written");
        assert!(has(&pak, "\"Renamed\""));
        assert_eq!(ctx.settings.get("schemaPending"), Some(&json!(false)));
    }

    #[test]
    fn a_build_whose_library_changed_while_it_was_made_is_not_written() {
        use crate::schema_service::{Begun, Ctx, SchemaService};
        let mut s = set_up("changed", &large(1200));
        add_mod(&mut s.lib, "Renamer", "2", "Renamed");
        let mut svc = SchemaService::new(&s._ud.0, false);
        let (mut log, mut deployed) = (|_: String| {}, |_: std::collections::HashSet<String>| {});
        let job = {
            let mut ctx = Ctx {
                inst: &s.inst,
                lib: &mut s.lib,
                settings: &mut s.settings,
                bases: None,
                log: &mut log,
                on_deployed: &mut deployed,
            };
            let Begun::Job(job) = svc.begin(&mut ctx) else { panic!("a build to make") };
            job
        };
        // made with nothing held: the window turned the mod off meanwhile
        let made = SchemaService::make(job, None, &|| false, &mut |_, _| {}, &mut |_| {});
        let id = s.lib.list()[0]["id"].clone();
        s.lib.update(&id, &json!({ "enabled": false }), None).unwrap();
        let mut ctx = Ctx {
            inst: &s.inst,
            lib: &mut s.lib,
            settings: &mut s.settings,
            bases: None,
            log: &mut log,
            on_deployed: &mut deployed,
        };
        let out = svc.finish(&mut ctx, made, &|| false);
        assert_eq!(out.superseded, Some(true), "{out:?}");
        assert_eq!(table_written(&s.game.0), None, "a table of a library that is gone was written");
        // still owed: the next start builds it
        assert_eq!(ctx.settings.get("schemaPending"), Some(&json!(true)));
    }

    #[test]
    fn a_build_begun_while_another_was_made_wins_and_the_older_one_is_not_written() {
        use crate::schema_service::{Begun, Ctx, SchemaService};
        let mut s = set_up("newer", &large(1200));
        add_mod(&mut s.lib, "Renamer", "2", "Renamed");
        let mut svc = SchemaService::new(&s._ud.0, false);
        let (mut log, mut deployed) = (|_: String| {}, |_: std::collections::HashSet<String>| {});
        let mut ctx = Ctx {
            inst: &s.inst,
            lib: &mut s.lib,
            settings: &mut s.settings,
            bases: None,
            log: &mut log,
            on_deployed: &mut deployed,
        };
        let Begun::Job(older) = svc.begin(&mut ctx) else { panic!("a build to make") };
        let older = SchemaService::make(older, None, &|| false, &mut |_, _| {}, &mut |_| {});
        // a build in place (the patch switched, a repair) ran to the end meanwhile
        let newer = svc.refresh(&mut ctx, &|| false, &mut |_, _| {});
        assert_eq!(newer.deployed, Some(true), "{newer:?}");
        std::fs::remove_file(s.game.0.join(crate::patcher::FOLDER).join(SCHEMA_VPK)).unwrap();
        let out = svc.finish(&mut ctx, older, &|| false);
        assert_eq!(out.superseded, Some(true), "{out:?}");
        assert_eq!(table_written(&s.game.0), None, "the older build wrote over the newer one");
    }
}
