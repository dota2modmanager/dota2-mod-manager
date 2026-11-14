//! Putting the game back after something else changed it (src/game-repair.ts). A Dota patch
//! overwrites the patched gameinfo and moves the item table; Steam's file check puts back files a
//! font or cursor mod replaced. Repaired once at start for a game that changed while the app was
//! closed, and again the moment the patch watcher sees a patch land. Never while Dota is running:
//! it holds those files open, so a write would half-succeed. The TypeScript owns a timer to look
//! again; here the answer says so (`retry`), and the shell picks the moment.

use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::installer::Installer;
use crate::library::Library;
use crate::schema_service::{Ctx, SchemaService};
use crate::update_impact::{impact_mods, UpdateImpact};

/// How long a repair waits for Dota to close before it looks again.
pub const REPAIR_RETRY_MS: u64 = 20000;

/// A mod Steam's file check took away that the app could not put back from what it holds.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Stuck {
    pub id: Value,
    pub name: Value,
}

/// Which mods the patch reached: the note, and the game's build for the words on the screen.
pub struct Impact<'a> {
    pub note: &'a UpdateImpact,
    pub build: Option<String>,
}

/// What builds again the mods the app built out of the game's files; the ids it built.
pub type Rebuild<'a> = &'a mut dyn FnMut(&Installer, &mut Library, &[String]) -> Vec<String>;

/// What a repair after a patch came to: what the window is told (none without a game), whether to
/// look again in REPAIR_RETRY_MS, and whether the item table wants a build in the background.
#[derive(Debug, Default)]
pub struct After {
    pub sent: Option<Value>,
    pub retry: bool,
    pub rebuild: bool,
}

/// The repair's own state between calls.
pub struct GameRepair {
    verify_stuck: Vec<Stuck>,
    patch_repair: Value,
}

impl Default for GameRepair {
    fn default() -> Self {
        GameRepair { verify_stuck: vec![], patch_repair: json!({ "state": "idle" }) }
    }
}

fn game_of(ctx: &Ctx) -> Option<PathBuf> {
    ctx.settings.get("dotaGamePath").filter(|v| crate::js::truthy(v)).map(|v| PathBuf::from(crate::js::string(v)))
}

impl GameRepair {
    pub fn verify_stuck(&self) -> &[Stuck] {
        &self.verify_stuck
    }

    pub fn patch_repair(&self) -> &Value {
        &self.patch_repair
    }

    /// The state the window is told; the caller sends it.
    pub fn set_patch_repair(&mut self, next: Value) -> Value {
        self.patch_repair = next;
        self.patch_repair.clone()
    }

    /// Put back what Steam's file check took away, from what the app holds; how many came back.
    /// What would need downloading is left alone and reported instead.
    pub fn restore_after_verify(&mut self, inst: &Installer, lib: &Library, diag: &mut dyn FnMut(String)) -> usize {
        let records = lib.list();
        let lost = inst.lost_to_verify(records);
        if lost.is_empty() {
            return 0;
        }
        let mut stuck = Vec::new();
        let mut restored = 0;
        for i in lost {
            let rec = &records[i];
            let name = rec.get("name").map(crate::js::string).unwrap_or_default();
            let mine = || Stuck {
                id: rec.get("id").cloned().unwrap_or(Value::Null),
                name: rec.get("name").cloned().unwrap_or(Value::Null),
            };
            match inst.restore_deployed(rec) {
                Ok(Some(from)) => {
                    restored += 1;
                    diag(format!("restored after verify: {name} (from {from})"));
                }
                Ok(None) => stuck.push(mine()),
                Err(e) => {
                    diag(format!("restore failed for {name}: {e}"));
                    stuck.push(mine());
                }
            }
        }
        self.verify_stuck = stuck;
        restored
    }

    /// The item table and the search-path patch put back, and the files Steam took.
    fn heal(
        &mut self,
        schema: &mut SchemaService,
        ctx: &mut Ctx,
        diag: &mut dyn FnMut(String),
    ) -> (Vec<String>, Option<String>, bool) {
        // in the background: this runs at start and when a patch lands, with the window up (issue #286)
        let res = schema.heal(ctx, true);
        let mut healed: Vec<String> = res.healed.iter().map(|s| s.to_string()).collect();
        if self.restore_after_verify(ctx.inst, ctx.lib, diag) > 0 {
            healed.push("files".into());
        }
        (healed, res.error, res.rebuild)
    }

    /// Which installed mods the patch reached, by name, for the banner. A mod the app built out of
    /// the game's files is built again out of the new ones and gets no mark.
    fn touched(
        &self,
        ctx: &mut Ctx,
        impact: Option<&Impact>,
        rebuild: &mut Option<Rebuild>,
        diag: &mut dyn FnMut(String),
    ) -> Option<Value> {
        let impact = impact?;
        let mods = impact_mods(ctx.lib.list(), &|r| ctx.inst.lang_file_on_disk(r).unwrap_or_default());
        let reached = match impact.note.check(&mods, impact.build.clone(), &mut *diag) {
            Ok(v) if !v.is_null() => v,
            Ok(_) => return None,
            Err(e) => {
                diag(format!("update impact skipped: {e}"));
                return None;
            }
        };
        let ids: Vec<String> = reached["ids"].as_array().into_iter().flatten().map(crate::js::string).collect();
        let rebuilt: Vec<String> = match rebuild {
            Some(f) => f(ctx.inst, ctx.lib, &ids),
            None => vec![],
        };
        for id in &rebuilt {
            if let Err(e) = impact.note.clear(id) {
                diag(format!("update impact skipped: {e}"));
                return None;
            }
        }
        let ids: Vec<&String> = ids.iter().filter(|id| !rebuilt.contains(id)).collect();
        if ids.is_empty() {
            return None;
        }
        let names: Map<String, Value> = ctx
            .lib
            .list()
            .iter()
            .map(|r| {
                (r.get("id").map(crate::js::string).unwrap_or_default(), r.get("name").cloned().unwrap_or(Value::Null))
            })
            .collect();
        let mods: Vec<Value> = ids
            .iter()
            .map(|id| match names.get(id.as_str()) {
                Some(n) if crate::js::truthy(n) => n.clone(),
                _ => json!(id),
            })
            .collect();
        Some(json!({ "build": reached.get("to").cloned().unwrap_or(Value::Null), "mods": mods }))
    }

    /// Repair after a patch, or say to wait: for Dota to close (`running`), or for Steam's file
    /// check or update (`steam`), whose next write would land over the repair.
    #[allow(clippy::too_many_arguments)]
    pub fn repair_after_patch(
        &mut self,
        schema: &mut SchemaService,
        ctx: &mut Ctx,
        impact: Option<&Impact>,
        mut rebuild: Option<Rebuild>,
        reason: Option<Value>,
        (running, steam): (bool, Option<&str>),
        now: f64,
        diag: &mut dyn FnMut(String),
    ) -> After {
        let Some(game) = game_of(ctx) else { return After::default() };
        let waiting = |me: &mut Self, steam: Option<&str>| {
            let mut s = json!({ "state": "waiting", "at": crate::js::json_number(now) });
            if let Some(r) = &reason {
                s["reason"] = r.clone();
            }
            if let Some(w) = steam {
                s["steam"] = json!(w);
            }
            After { sent: Some(me.set_patch_repair(s)), retry: true, rebuild: false }
        };
        if running {
            diag("Dota patched while the game is running - repair deferred".into());
            return waiting(self, None);
        }
        if let Some(w) = steam {
            diag(format!("Steam is {w} the game - repair deferred"));
            return waiting(self, Some(w));
        }

        let (healed, error, wants) = self.heal(schema, ctx, diag);
        // remembered only now: a stamp stored before a failed repair would make the next start
        // think there is nothing to fix
        let _ = ctx.settings.set("gameStamp", json!(crate::patch_watch::game_stamp(Some(&game))));
        let done = if healed.is_empty() { "nothing to do".to_string() } else { healed.join(",") };
        let err = error.as_ref().filter(|e| !e.is_empty()).map(|e| format!(" error={e}")).unwrap_or_default();
        diag(format!("repair after patch: {done}{err}"));
        let hit = self.touched(ctx, impact, &mut rebuild, diag);
        let failed = error.as_ref().is_some_and(|e| !e.is_empty());
        let mut s = json!({
            "state": if failed { "failed" } else { "done" }, "healed": healed, "error": error,
            "at": crate::js::json_number(now),
        });
        if let Some(h) = hit {
            s["touched"] = h;
        }
        After { sent: Some(self.set_patch_repair(s)), retry: false, rebuild: wants }
    }

    /// The same repair at start, before the window exists, for a game patched while the app was
    /// closed. The build stamp only decides whether the user is told; true when the item table
    /// wants a build in the background.
    pub fn repair_at_start(
        &mut self,
        schema: &mut SchemaService,
        ctx: &mut Ctx,
        impact: Option<&Impact>,
        mut rebuild: Option<Rebuild>,
        now: f64,
        diag: &mut dyn FnMut(String),
    ) -> bool {
        let (healed, error, wants) = self.heal(schema, ctx, diag);
        let schema_healed: Vec<&str> = healed.iter().map(String::as_str).filter(|h| *h != "files").collect();
        if !schema_healed.is_empty() {
            diag(format!("schema healed: {}", schema_healed.join(",")));
        }
        let failed = error.as_ref().is_some_and(|e| !e.is_empty());
        if failed {
            diag(format!("schema heal failed: {}", error.as_deref().unwrap_or("")));
        }
        let hit = self.touched(ctx, impact, &mut rebuild, diag);
        let stamp = crate::patch_watch::game_stamp(game_of(ctx).as_deref());
        let known = ctx.settings.get("gameStamp").cloned().unwrap_or(Value::Null);
        // a patch that reached a mod is told about even when the build stamp missed it
        let changed = stamp.is_some() && crate::js::truthy(&known) && json!(stamp) != known;
        if changed || hit.is_some() {
            if changed {
                diag(format!(
                    "Dota changed while the app was closed: {} -> {}",
                    crate::js::string(&known),
                    stamp.as_deref().unwrap_or("")
                ));
            }
            let mended = changed && !schema_healed.is_empty();
            let mut s = json!({
                "state": if failed { "failed" } else { "done" }, "healed": healed, "error": error,
                "at": crate::js::json_number(now),
            });
            if let Some(h) = hit {
                s["touched"] = h;
            }
            if mended {
                s["whileClosed"] = json!(true);
            }
            self.patch_repair = s;
        }
        if let Some(st) = stamp {
            if let Err(e) = ctx.settings.set("gameStamp", json!(st)) {
                diag(format!("build check skipped: {e}"));
            }
        }
        wants
    }
}
