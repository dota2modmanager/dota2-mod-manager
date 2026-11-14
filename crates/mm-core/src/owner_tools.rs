//! The studios that read the game's own pictures, sounds and effects (src/ipc-sounds.ts,
//! ipc-icons.ts, ipc-effects.ts, ipc-rank.ts, ipc-paint.ts). Their services keep indexes worth
//! keeping between calls, so [`Kept`] holds them until the game folder or the language changes.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::ability_icons_service::AbilityIconsService;
use crate::effect_edit_service::{EffectEdit, Finder};
use crate::effect_finder::EffectFinder;
use crate::owner::{arg, Core, Owner, R};
use crate::rank_look_service::RankLookService;

pub const CHANNELS: &[&str] = &[
    "sounds:heroes",
    "sounds:hero",
    "sounds:add",
    "sounds:remove",
    "icons:heroes",
    "icons:hero",
    "icons:pictures",
    "icons:set",
    "icons:clear",
    "fx:search",
    "fx:heroes",
    "fx:hero",
    "fx:load",
    "fx:preview",
    "fx:install",
    "rank:state",
    "rank:pictures",
    "rank:install",
    "paint:state",
    "paint:icons",
    "paint:install",
];

/// The services with indexes of their own, for one game folder and one language.
#[derive(Default)]
pub struct Kept {
    key: Option<(Option<PathBuf>, &'static str)>,
    effect: Option<EffectEdit>,
    finder: EffectFinder,
    icons: Option<AbilityIconsService>,
    rank: Option<RankLookService>,
    arcana: Option<crate::arcana_service::ArcanaService>,
}

impl Kept {
    /// Everything dropped when the game or the language is not the one they were made for.
    fn fit(&mut self, game: &Option<PathBuf>) {
        let key = (game.clone(), crate::i18n::lang().code());
        if self.key.as_ref() != Some(&key) {
            *self = Kept { key: Some(key), ..Kept::default() };
        }
    }

    /// The arcana window's service for this game (it keeps what it read of the game's files).
    pub fn arcana(&mut self, game: &Option<PathBuf>) -> &mut crate::arcana_service::ArcanaService {
        self.fit(game);
        self.arcana.get_or_insert_with(|| {
            crate::arcana_service::ArcanaService::new(game.clone(), Some(crate::schema_service::builder_stamp()))
        })
    }
}

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

fn lang() -> &'static str {
    crate::i18n::lang().code()
}

/// `{ ok: true, ...value }`, or `{ error }`.
fn spread(r: Result<Value, String>) -> Value {
    match r {
        Ok(v) => {
            let mut out = Map::new();
            out.insert("ok".into(), Value::Bool(true));
            if let Some(o) = v.as_object() {
                out.extend(o.clone());
            }
            Value::Object(out)
        }
        Err(e) => json!({ "error": e }),
    }
}

fn vrf(c: &Core) -> Option<PathBuf> {
    crate::toolchain::Toolchain::new(&c.user_data, None).path_of("vrf")
}

/// A ValveResourceFormat run: the exit code 0 or the error.
fn run_tool(exe: &str, args: &[String]) -> Result<(), String> {
    match crate::run_process::run(exe, args, None, &[], 60_000)? {
        (0, _) => Ok(()),
        (code, out) => Err(format!("{exe} exited {code}: {}", out.trim())),
    }
}

/// The game's item table as text, for the services that read it.
fn table(c: &mut Core) -> Option<Arc<(Vec<u8>, String)>> {
    let game = c.game()?;
    c.schema.vanilla(&game).ok()
}

/// An install's answer: the record built, the master switch's off state put back.
fn installed(o: &Owner, build: impl FnOnce(&mut Core, &mut dyn FnMut(String)) -> Result<Value, String>) -> Value {
    if let Some(stop) = o.blocked("install") {
        return stop;
    }
    built(o, build)
}

fn built(o: &Owner, build: impl FnOnce(&mut Core, &mut dyn FnMut(String)) -> Result<Value, String>) -> Value {
    let mut lines = Vec::new();
    let r = {
        let mut c = o.core();
        let r = build(&mut c, &mut |m| lines.push(m));
        if r.is_ok() {
            crate::owner_packs::after_deploy_master(&c);
        }
        r
    };
    for l in lines {
        o.diag(&l);
    }
    match r {
        Ok(record) => json!({ "ok": true, "record": record }),
        Err(e) => json!({ "error": e }),
    }
}

/// The icon service, made once per game and language over the game's item table.
fn icons(c: &mut Core) -> Result<&mut AbilityIconsService, String> {
    let game = c.game();
    c.kept.fit(&game);
    if c.kept.icons.is_none() {
        let base = table(c).map(|b| b.0.clone()).unwrap_or_default();
        let has_vrf = vrf(c).is_some();
        c.kept.icons = Some(AbilityIconsService::new(game, base, lang(), has_vrf)?);
    }
    Ok(c.kept.icons.as_mut().expect("made above"))
}

fn rank(c: &mut Core) -> &mut RankLookService {
    let game = c.game();
    c.kept.fit(&game);
    c.kept.rank.get_or_insert_with(|| RankLookService::new(game))
}

fn sounds(c: &Core) -> crate::ability_sounds_service::AbilitySoundsService {
    crate::ability_sounds_service::AbilitySoundsService::new(c.game(), &c.user_data)
}

fn pak01(game: &Option<PathBuf>) -> Result<Arc<crate::vpk::Index>, String> {
    let g = game.as_ref().ok_or_else(|| crate::i18n::t("Не указана папка игры", &[]))?;
    crate::vpk_shared::shared_index(&g.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())
}

/// The heroes the sounds studio knows, by their npc names, in its order.
fn hero_names(c: &Core) -> Vec<String> {
    sounds(c)
        .heroes()
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|a| a.iter().filter_map(|h| h.get("hero").and_then(Value::as_str).map(String::from)).collect())
        .unwrap_or_default()
}

/// One effect studio call, with the finder and the item table at hand.
fn with_effects<T>(
    c: &mut Core,
    f: impl FnOnce(&mut EffectEdit, Option<Finder>, &crate::installer::Installer, &mut crate::library::Library) -> T,
) -> T {
    let game = c.game();
    c.kept.fit(&game);
    let text = table(c).map(|b| crate::kv::latin1(&b.0));
    let Core { kept, installer, library, .. } = c;
    let effect = kept.effect.get_or_insert_with(|| EffectEdit::new(game));
    let finder = Some(Finder { finder: &mut kept.finder, lang: lang(), table: text.as_deref() });
    f(effect, finder, installer, library)
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a = |i: usize| arg(args, i);
    let s = |i: usize| crate::js::string(&arg(args, i));
    match channel {
        "sounds:heroes" => spread(sounds(&o.core()).heroes().map(|h| json!({ "heroes": h }))),
        "sounds:hero" => {
            let c = o.core();
            spread(sounds(&c).hero(&c.library, &s(0)))
        }
        "sounds:add" => {
            let wav = match crate::owner::bytes_of(&a(4)) {
                Ok(w) => w.unwrap_or_default(),
                Err(e) => return json!({ "error": e }),
            };
            let label = if crate::js::truthy(&a(5)) { s(5) } else { String::new() };
            let volume = crate::js::to_number(&a(3));
            installed(o, |c, log| {
                let svc = sounds(c);
                let keep = |cc: &Core| (crate::owner_compiler::compiler(cc), crate::owner_compiler::keeper(cc));
                let (rc, k) = keep(c);
                let mut compile = |job: &crate::resource_compiler::CompileJob| {
                    rc.compile(job, k.as_ref(), &mut crate::run_process::run, &mut |_| {})
                };
                let Core { installer, library, .. } = c;
                svc.add(installer, library, (&s(0), &s(1), &s(2), volume, &wav, &label), &mut compile, log)
            })
        }
        "sounds:remove" => {
            let r = built(o, |c, log| {
                let svc = sounds(c);
                let (rc, k) = (crate::owner_compiler::compiler(c), crate::owner_compiler::keeper(c));
                let mut compile = |job: &crate::resource_compiler::CompileJob| {
                    rc.compile(job, k.as_ref(), &mut crate::run_process::run, &mut |_| {})
                };
                let Core { installer, library, .. } = c;
                svc.remove(installer, library, &s(0), &s(1), &mut compile, log)
            });
            r
        }
        "icons:heroes" => {
            let mut c = o.core();
            spread(icons(&mut c).and_then(|svc| svc.heroes()).map(|h| json!({ "heroes": h })))
        }
        "icons:hero" => {
            let mut c = o.core();
            let r = icons(&mut c).map(|_| ());
            let Core { kept, library, .. } = &mut *c;
            spread(r.and_then(|_| kept.icons.as_ref().expect("made above").hero(library, &s(0))))
        }
        "icons:pictures" | "paint:icons" => pictures(o, &a(0)),
        "icons:set" => {
            let icon = a(2).as_str().map(String::from);
            installed(o, |c, log| {
                icons(c)?;
                let Core { kept, installer, library, .. } = c;
                kept.icons.as_ref().expect("made above").set(installer, library, (&s(0), &s(1), icon.as_deref()), log)
            })
        }
        "icons:clear" => built(o, |c, log| {
            icons(c)?;
            let Core { kept, installer, library, .. } = c;
            kept.icons.as_ref().expect("made above").clear(installer, library, &s(0), log)
        }),
        "fx:search" => {
            let mut c = o.core();
            let heroes = hero_names(&c);
            let game = c.game();
            let query = s(0);
            let r = (|| -> Result<Value, String> {
                let paths = with_effects(&mut c, |e, _, _, _| e.search(&query))?;
                let ix = pak01(&game)?;
                let abilities = c.kept.finder.abilities(&ix, lang(), &heroes, &query);
                Ok(
                    json!({ "ok": true, "paths": paths, "abilities": abilities, "saved": EffectEdit::saved(&c.library) }),
                )
            })();
            r.unwrap_or_else(|e| json!({ "error": e }))
        }
        "fx:heroes" => {
            let c = o.core();
            match sounds(&c).heroes() {
                Ok(list) => {
                    let heroes: Vec<Value> = list
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|h| json!({ "hero": h.get("hero"), "name": h.get("name") }))
                        .collect();
                    json!({ "ok": true, "heroes": heroes })
                }
                Err(e) => json!({ "error": e }),
            }
        }
        "fx:hero" => {
            let mut c = o.core();
            let game = c.game();
            c.kept.fit(&game);
            match pak01(&game) {
                Ok(ix) => json!({ "ok": true, "groups": c.kept.finder.hero(&ix, lang(), &s(0)) }),
                Err(e) => json!({ "error": e }),
            }
        }
        "fx:load" => spread(with_effects(&mut o.core(), |e, f, _, lib| e.load(lib, &a(0), f))),
        "fx:preview" => match with_effects(&mut o.core(), |e, f, _, _| e.preview(&a(0), &a(1), f)) {
            Ok(defs) => json!({ "ok": true, "defs": defs }),
            Err(e) => json!({ "error": e }),
        },
        "fx:install" => {
            let items = a(2) == Value::Bool(true);
            installed(o, |c, log| {
                with_effects(c, |e, f, inst, lib| e.install(inst, lib, (&a(0), &a(1), items), f, log))
            })
        }
        "rank:state" => {
            let mut c = o.core();
            let has_vrf = vrf(&c).is_some();
            rank(&mut c);
            let Core { kept, library, .. } = &mut *c;
            spread(Ok(kept.rank.as_mut().expect("made above").state(library, has_vrf)))
        }
        "rank:pictures" => {
            let mut lines = Vec::new();
            let r = {
                let mut c = o.core();
                let exe = vrf(&c).map(|p| p.to_string_lossy().into_owned());
                rank(&mut c).pictures(exe.as_deref(), &mut run_tool, &std::env::temp_dir(), &mut |m| lines.push(m))
            };
            for l in lines {
                o.diag(&l);
            }
            spread(r)
        }
        "rank:install" => installed(o, |c, log| {
            rank(c);
            let Core { kept, installer, library, .. } = c;
            kept.rank.as_ref().expect("made above").install(installer, library, &a(0), log)
        }),
        "paint:state" => {
            let mut c = o.core();
            let has_vrf = vrf(&c).is_some();
            let base = table(&mut c).map(|b| b.0.clone()).unwrap_or_default();
            let svc = crate::hero_paint_service::HeroPaintService::new(c.game(), lang());
            spread(svc.state(&c.library, &base, &s(0), &a(1), has_vrf))
        }
        "paint:install" => installed(o, |c, log| {
            let base = table(c).map(|b| b.0.clone()).unwrap_or_default();
            let svc = crate::hero_paint_service::HeroPaintService::new(c.game(), lang());
            let exe = vrf(c).map(|p| p.to_string_lossy().into_owned());
            let (rc, k) = (crate::owner_compiler::compiler(c), crate::owner_compiler::keeper(c));
            let mut compile = |job: &crate::resource_compiler::CompileJob| {
                rc.compile(job, k.as_ref(), &mut crate::run_process::run, &mut |_| {})
            };
            let tmp = std::env::temp_dir();
            let mut decode =
                |exe: &str, vtex: &[u8]| crate::hero_paint_service::vrf_png(exe, vtex, &tmp, &mut run_tool);
            let mut tools = crate::hero_paint_service::Tools {
                vrf: exe,
                repaint: &crate::png_paint::repaint,
                decode: &mut decode,
                compile: Some(&mut compile),
            };
            let Core { installer, library, .. } = c;
            svc.install(installer, library, &base, (&a(0), &a(1), &a(2), &a(3)), &mut tools, log)
        }),
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}

/// Abilities' icons out of the game, as data URIs; nothing for a list it could not read.
fn pictures(o: &Owner, names: &Value) -> Value {
    let (icons, game, exe) = {
        let c = o.core();
        (c.game_icons.clone(), c.game(), vrf(&c))
    };
    let list = names.as_array().cloned().unwrap_or_default();
    let mut lines = Vec::new();
    let out = icons.ability_icons(game.as_deref(), exe.as_deref().map(Path::new), &list, &mut |m| lines.push(m));
    for l in lines {
        o.diag(&l);
    }
    json!(out)
}
