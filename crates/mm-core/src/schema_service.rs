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
use crate::item_builder_everyone::{everyone_wears, SchemaPatch};
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

impl crate::background_builds::Outcome for Refreshed {
    fn cancelled() -> Self {
        Refreshed { ok: true, cancelled: Some(true), ..Default::default() }
    }
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
}

impl SchemaService {
    pub fn new(user_data_dir: &Path, with_files: bool) -> Self {
        SchemaService {
            backup_dir: user_data_dir.join("backups").join("patch"),
            table: TableBuild::new(),
            files: with_files.then(ItemFilesPak::default),
            cache: None,
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
    /// over (asked before the write); `progress`: (done, total) of the picks built anew.
    pub fn refresh(
        &mut self,
        ctx: &mut Ctx,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Refreshed {
        let Some(game) = ctx.game() else {
            return Refreshed { ok: false, reason: Some("no-game-path".into()), ..Default::default() };
        };
        // said before the build and unsaid when one writes: an app closed in between left the game a
        // change behind the library, and the next start did not notice
        if let Err(e) = ctx.set("schemaPending", json!(true)) {
            return failed(e);
        }
        match self.refresh_in(ctx, &game, stop, progress) {
            Ok(r) => r,
            Err(e) => failed(e),
        }
    }

    fn refresh_in(
        &mut self,
        ctx: &mut Ctx,
        game: &Path,
        stop: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<Refreshed, String> {
        // the master switch renames the language folder's paks; the table, in a folder of its own,
        // goes too, and the switch builds it again
        if ctx.mods_off() {
            return Self::drop_table(ctx, game);
        }
        let records = ctx.lib.list().to_vec();
        if !ctx.on("schemaPatch") {
            let picks = ctx.picks_on();
            if self.files.is_none() || picks == 0 {
                if self.files.is_some() {
                    ItemFilesPak::clear(ctx.inst, ctx.lib)?;
                }
                return Self::drop_table(ctx, game);
            }
            let base = self.vanilla(game)?;
            let built = self.table.build(&base.0, game, &records, ctx.bases, progress, ctx.log)?;
            let ix =
                crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let files = self.files.as_mut().expect("checked above");
            let filled = files.build(&built, &read, picks)?;
            if stop() {
                return Ok(Refreshed { ok: true, superseded: Some(true), ..Default::default() });
            }
            // the table's, if one was up: the pak takes over after it
            let out = Self::drop_table(ctx, game)?;
            files.commit(ctx.inst, ctx.lib, ctx.log)?;
            ctx.set("schemaStamp", json!(Self::stamp_of(Some(&base.1))))?;
            (ctx.on_deployed)(filled);
            return Ok(Refreshed { deployed: Some(true), patches: Some(picks), ..out });
        }
        if self.files.is_some() {
            ItemFilesPak::clear(ctx.inst, ctx.lib)?;
        }
        let base = self.vanilla(game)?;
        let built = self.table.build(&base.0, game, &records, ctx.bases, progress, ctx.log)?;
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
        if ctx.on("everyoneWearsMine") {
            let ix =
                crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let more = everyone_wears(&base.0, &list, &built.beneath, &read, None).map_err(|e| e.to_string())?;
            list.extend(more);
        }
        if list.is_empty() {
            return Self::drop_table(ctx, game);
        }
        let patches: Vec<Patch> =
            list.iter().map(|p| Patch { id: p.id.clone(), block: p.block.clone(), source: p.source.clone() }).collect();
        let mut assets: Vec<&[crate::vpk::Entry]> = list.iter().map(|p| p.assets.as_slice()).collect();
        assets.push(&built.beneath);
        let Some(res) = schema_deploy::deploy(game, patcher::FOLDER, &patches, &assets, (&base.0, &base.1), stop)?
        else {
            return Ok(Refreshed { ok: true, superseded: Some(true), ..Default::default() });
        };
        ctx.set("schemaStamp", json!(Self::stamp_of(Some(&res.stamp))))?;
        ctx.set("schemaPending", json!(false))?;
        // with the bases' files, which the arcana window covered with Valve's: a plain body
        let filled =
            list.iter().flat_map(|p| p.assets.iter()).chain(&built.beneath).map(|e| e.path().to_lowercase()).collect();
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
