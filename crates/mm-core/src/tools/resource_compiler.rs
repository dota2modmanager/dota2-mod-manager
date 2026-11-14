//! resourcecompiler.exe: Valve's compiler from the Dota 2 Workshop Tools, run on sources the app
//! staged, for the compiled files an arcana base, a hero's paint or an ability's sounds are made of
//! (src/resource-compiler.ts).
//!
//! The compiler is not ours to ship: it comes with the Workshop Tools, a free DLC of Dota's in
//! Steam. It is found in game/bin/win64 of the user's game, or in a file the user picked, or in
//! the copy kept for Linux (workshop_tools.rs), and on Linux it runs under Wine in a prefix of
//! the app's (wine.rs).
//!
//! A source under content/dota_addons/<addon>/ of the compiler's install is compiled into the same
//! path under game/dota_addons/<addon>/, with "-nop4 -f -i <source>" from the compiler's folder.
//! The addon is ours (d2mm_<id>), made for one compile and deleted after it. A compile is minutes:
//! the shell runs `compile` off the main thread and one at a time, since every compile writes the
//! install's asset list.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::vpk::Entry;
use crate::wine::{ensure_prefix, prefix_ready, wine_env, wine_path, RunProcess};
use crate::workshop_tools::ToolsKeeper;

/// The compiler's file name, as the Workshop Tools install it.
pub const COMPILER: &str = "resourcecompiler.exe";
/// A hero model with its animations is minutes, not seconds.
const COMPILE_TIMEOUT_MS: u64 = 10 * 60 * 1000;

/// The check Settings runs: the empty model a persona's base puts at each of the hero's slots.
const EMPTY_MODEL: &str = "<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc41:version{12fc9d44-453a-4ae4-b4d9-7e2ac0bbd4e0} -->
{
\trootNode =
\t{
\t\t_class = \"RootNode\"
\t\tchildren = [  ]
\t\tmodel_archetype = \"\"
\t\tprimary_associated_entity = \"\"
\t\tanim_graph_name = \"\"
\t\tbase_model_name = \"\"
\t}
}
";
const CHECK_SOURCE: &str = "models/d2mm_check/empty.vmdl";

/// Where the Workshop Tools put the compiler in a game folder (dota 2 beta/game).
pub fn compiler_in(game: &Path) -> PathBuf {
    game.join("bin").join("win64").join(COMPILER)
}

fn base_lower(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// The install a compiler belongs to, the folder with game/ and content/ in it, or None when it is
/// not one: the compiler finds the game through its own place in game/bin/win64.
pub fn install_of(exe: Option<&Path>) -> Option<PathBuf> {
    let exe = exe.filter(|e| !e.as_os_str().is_empty())?;
    if base_lower(exe) != COMPILER {
        return None;
    }
    let abs = crate::safe_zip::resolve(exe);
    let win64 = abs.parent()?;
    let bin = win64.parent()?;
    if base_lower(win64) != "win64" || base_lower(bin) != "bin" {
        return None;
    }
    let game = bin.parent()?;
    (exe.exists() && game.join("dota").join("gameinfo.gi").exists()).then(|| game.parent().map(Path::to_path_buf))?
}

/// A path inside an addon, as the game spells it: forward slashes, nothing that climbs out.
pub fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !Path::new(rel).is_absolute()
        && !rel.contains(['\\', ':', '\0'])
        && rel.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

/// What a source compiles to: a sound to a .vsnd_c, a Panorama style, layout or script to .vcss_c,
/// .vxml_c or .vjs_c, anything else to its own name and _c.
pub fn compiled_of(rel: &str) -> String {
    let lower = rel.to_lowercase();
    for ext in [".wav", ".mp3"] {
        if lower.ends_with(ext) {
            return format!("{}.vsnd_c", &rel[..rel.len() - ext.len()]);
        }
    }
    if lower.starts_with("panorama/") {
        for (ext, to) in [("css", ".vcss_c"), ("xml", ".vxml_c"), ("js", ".vjs_c")] {
            if lower.ends_with(&format!(".{ext}")) && rel.len() > "panorama/".len() + ext.len() {
                return format!("{}{to}", &rel[..rel.len() - ext.len() - 1]);
            }
        }
    }
    format!("{rel}_c")
}

/// A source file to stage, at its path in the addon.
pub struct SourceFile {
    pub path: String,
    pub data: Vec<u8>,
}

/// One compile: the addon's sources, and which of them to hand the compiler.
pub struct CompileJob {
    pub id: String,
    pub files: Vec<SourceFile>,
    pub compile: Vec<String>,
}

/// The last lines of what the compiler said, for an error a person can send along.
fn tail(out: &str, n: usize) -> String {
    let lines: Vec<&str> =
        crate::js::trim(out).split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join(" | ")
}

fn walk(dir: &Path, base: &Path, out: &mut Vec<String>) {
    let Ok(rd) = crate::js::read_dir(dir) else { return };
    for e in rd {
        let p = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            walk(&p, base, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// Where the compiler that runs comes from: picked in Settings, the game's own, or the kept copy.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Source {
    Chosen,
    Game,
    Kept,
}

impl Source {
    fn name(self) -> &'static str {
        match self {
            Source::Chosen => "chosen",
            Source::Game => "game",
            Source::Kept => "kept",
        }
    }
}

/// The compiler as the app runs it: where it is, what it needs, and a compile.
pub struct ResourceCompiler {
    pub user_data: PathBuf,
    /// the game folder in Settings (dota 2 beta/game)
    pub game: Option<PathBuf>,
    /// the compiler the user picked in Settings
    pub chosen: Option<PathBuf>,
    /// whether it runs through Wine (off Windows)
    pub needs_wine: bool,
    /// the Wine found here (wine.rs find_wine), when it needs one
    pub wine: Option<PathBuf>,
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

impl ResourceCompiler {
    pub fn new(user_data: &Path, game: Option<PathBuf>, chosen: Option<PathBuf>) -> Self {
        ResourceCompiler { user_data: user_data.to_path_buf(), game, chosen, needs_wine: !cfg!(windows), wine: None }
    }

    pub fn prefix(&self) -> PathBuf {
        self.user_data.join("wine")
    }

    fn check_file(&self) -> PathBuf {
        self.user_data.join("compiler-check.json")
    }

    /// A check counts for the compiler it ran on, as that file was, and for the game it compiled
    /// against: another one picked, a new resourcecompiler.exe, or a Dota patch is unchecked again.
    fn stamp_of(&self, exe: &Path) -> Option<String> {
        std::fs::metadata(exe).ok()?;
        let ms = crate::terrain_age::mtime_ms(exe)?;
        let version = self.game.as_deref().and_then(crate::patch_watch::client_version).unwrap_or_default();
        Some(format!("{}|{}|{version}", exe.display(), crate::js::number(ms)))
    }

    fn last_check(&self, exe: Option<&Path>) -> Value {
        let Some(exe) = exe else { return Value::Null };
        let Some(Value::Object(mut check)) =
            std::fs::read_to_string(self.check_file()).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok())
        else {
            return Value::Null;
        };
        let stamp = check.shift_remove("stamp");
        if stamp.as_ref().and_then(Value::as_str) == self.stamp_of(exe).as_deref() && stamp.is_some() {
            Value::Object(check)
        } else {
            Value::Null
        }
    }

    /// The compiler that runs: the one picked, when it is one, else the game's own, else the copy.
    pub fn locate(
        &self,
        keeper: Option<&ToolsKeeper>,
        log: &mut dyn FnMut(String),
    ) -> Option<(PathBuf, PathBuf, Source)> {
        if let Some(picked) = &self.chosen {
            if let Some(install) = install_of(Some(picked)) {
                return Some((picked.clone(), install, Source::Chosen));
            }
        }
        if let Some(game) = &self.game {
            let own = compiler_in(game);
            if let Some(install) = install_of(Some(&own)) {
                return Some((own, install, Source::Game));
            }
        }
        keeper.and_then(|k| k.usable(log)).map(|(exe, install)| (exe, install, Source::Kept))
    }

    /// What Settings shows of the compiler.
    pub fn state(&self, keeper: Option<&ToolsKeeper>, log: &mut dyn FnMut(String)) -> Value {
        let found = self.locate(keeper, log);
        let wine = if self.needs_wine { self.wine.clone() } else { None };
        let made = self.needs_wine && prefix_ready(&self.prefix());
        let exe = found.as_ref().map(|f| f.0.clone());
        json!({
            "exe": exe.as_ref().map(|e| e.to_string_lossy().into_owned()),
            "chosen": found.as_ref().is_some_and(|f| f.2 == Source::Chosen),
            "source": found.as_ref().map(|f| f.2.name()),
            "kept": keeper.and_then(|k| k.info()).map(|k| json!({
                "from": k.from, "stamp": k.stamp, "bytes": crate::js::json_number(k.bytes),
                "at": crate::js::json_number(k.at), "layout": crate::js::json_number(k.layout),
            })),
            "keepable": keeper.is_some_and(|k| k.keepable()),
            "keptOutdated": keeper.is_some_and(|k| k.outdated()),
            "needsWine": self.needs_wine,
            "wine": wine.as_ref().map(|w| w.to_string_lossy().into_owned()),
            "prefixReady": made,
            "ready": found.is_some() && (!self.needs_wine || (wine.is_some() && made)),
            "check": self.last_check(exe.as_deref()),
        })
    }

    /// Everything a compile needs before it starts: the compiler, and off Windows Wine with its prefix.
    pub fn prepare(
        &self,
        keeper: Option<&ToolsKeeper>,
        run: RunProcess,
        log: &mut dyn FnMut(String),
    ) -> Result<(PathBuf, PathBuf, Option<PathBuf>), String> {
        let (exe, install, _) = self.locate(keeper, log).ok_or_else(|| {
            t("Нужны Dota 2 Workshop Tools, бесплатное дополнение в Steam. Открой свойства Dota 2, вкладку «Доп. контент», отметь Dota 2 Workshop Tools и дождись загрузки", &[])
        })?;
        if !self.needs_wine {
            return Ok((exe, install, None));
        }
        let wine = self.wine.clone().ok_or_else(|| {
            t("Для resourcecompiler.exe нужен Wine: поставь его из пакетов своей системы или Proton в Steam", &[])
        })?;
        ensure_prefix(&self.prefix(), &wine.to_string_lossy(), run, log)?;
        Ok((exe, install, Some(wine)))
    }

    /// Compile a job: the files it made, at their paths. The caller runs one at a time.
    pub fn compile(
        &self,
        job: &CompileJob,
        keeper: Option<&ToolsKeeper>,
        run: RunProcess,
        log: &mut dyn FnMut(String),
    ) -> Result<Vec<Entry>, String> {
        let addon_ok = (1..=64).contains(&job.id.len())
            && job.id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_');
        if !addon_ok {
            return Err(format!("not an addon name: {}", job.id));
        }
        if let Some(f) = job.files.iter().find(|f| !safe_rel(&f.path)) {
            return Err(format!("not a path inside an addon: {}", f.path));
        }
        if let Some(c) = job.compile.iter().find(|c| !job.files.iter().any(|f| &f.path == *c)) {
            return Err(format!("{c} is to be compiled and is not among the sources"));
        }
        let (exe, install, wine) = self.prepare(keeper, &mut *run, log)?;
        log(format!("resourcecompiler: {} with {}", job.id, exe.display()));
        let addon = format!("d2mm_{}", job.id);
        let content = install.join("content").join("dota_addons").join(&addon);
        let out = install.join("game").join("dota_addons").join(&addon);
        let clean = || {
            for d in [&content, &out] {
                let _ = std::fs::remove_dir_all(d);
            }
        };
        clean();
        let made = (|| -> Result<Vec<Entry>, String> {
            for f in &job.files {
                let to = content.join(&f.path);
                std::fs::create_dir_all(to.parent().unwrap_or(&content)).map_err(io)?;
                std::fs::write(&to, &f.data).map_err(io)?;
            }
            let cwd = exe.parent().map(Path::to_path_buf);
            for rel in &job.compile {
                let source = content.join(rel);
                let src = match &wine {
                    Some(_) => wine_path(&source),
                    None => source.to_string_lossy().into_owned(),
                };
                let args: Vec<String> = vec!["-nop4".into(), "-f".into(), "-i".into(), src];
                let started = std::time::Instant::now();
                let (code, said) = match &wine {
                    Some(w) => {
                        let mut all = vec![exe.to_string_lossy().into_owned()];
                        all.extend(args);
                        run(&w.to_string_lossy(), &all, cwd.as_deref(), &wine_env(&self.prefix()), COMPILE_TIMEOUT_MS)?
                    }
                    None => run(&exe.to_string_lossy(), &args, cwd.as_deref(), &[], COMPILE_TIMEOUT_MS)?,
                };
                log(format!(
                    "resourcecompiler: {rel} exited with {code} after {} s",
                    crate::js::to_fixed(started.elapsed().as_secs_f64(), 1)
                ));
                // the tools' own libraries of two Dota updates: it refuses whatever the file
                if code != 0 && said.to_lowercase().contains("schema mismatches reported") {
                    return Err(t("Workshop Tools в игре от разных обновлений, и resourcecompiler.exe отказывается собирать. В Steam открой свойства Dota 2, «Установленные файлы», и проверь целостность файлов. Если не помогло, Valve ещё не обновили Workshop Tools под этот патч: подожди их обновления", &[]));
                }
                if code != 0 || !out.join(compiled_of(rel)).exists() {
                    let why = Some(tail(&said, 8)).filter(|s| !s.is_empty()).unwrap_or_else(|| format!("exit {code}"));
                    return Err(t("resourcecompiler.exe не собрал {0}: {1}", &[json!(rel), json!(why)]));
                }
            }
            // the compiled files, and not the tools' own notes about the addon beside them
            let mut rels = Vec::new();
            walk(&out, &out, &mut rels);
            rels.into_iter()
                .filter(|r| r.ends_with("_c") && !r.starts_with("tools_"))
                .map(|r| std::fs::read(out.join(&r)).map(|d| crate::vpk::entry_at(&r, d.into())).map_err(io))
                .collect()
        })();
        clean();
        made
    }

    /// Compile the empty model and keep how it went: whether this compiler, here, compiles at all.
    pub fn check(
        &self,
        keeper: Option<&ToolsKeeper>,
        run: RunProcess,
        on_step: &mut dyn FnMut(&str),
        log: &mut dyn FnMut(String),
    ) -> Value {
        let started = std::time::Instant::now();
        let tried = (|| -> Result<(), String> {
            if self.needs_wine {
                on_step("wine");
                self.prepare(keeper, &mut *run, log)?;
            }
            on_step("compile");
            let job = CompileJob {
                id: "check".into(),
                files: vec![SourceFile { path: CHECK_SOURCE.into(), data: EMPTY_MODEL.as_bytes().to_vec() }],
                compile: vec![CHECK_SOURCE.into()],
            };
            self.compile(&job, keeper, &mut *run, log).map(|_| ())
        })();
        let seconds = started.elapsed().as_secs_f64();
        let mut result = Map::new();
        result.insert("ok".into(), json!(tried.is_ok()));
        if let Err(e) = &tried {
            result.insert("message".into(), json!(e));
        }
        result.insert("seconds".into(), crate::js::json_number(seconds));
        result.insert("at".into(), crate::js::json_number(crate::library::now()));
        let exe = self.locate(keeper, log).map(|f| f.0);
        if let Some(stamp) = exe.as_deref().and_then(|e| self.stamp_of(e)) {
            let mut kept = result.clone();
            kept.insert("stamp".into(), json!(stamp));
            if std::fs::create_dir_all(&self.user_data).is_ok() {
                let _ = std::fs::write(self.check_file(), Value::Object(kept).to_string());
            }
        }
        let how = match &tried {
            Ok(()) => "passed".to_string(),
            Err(e) => format!("failed: {e}"),
        };
        log(format!("resourcecompiler: check {how} in {} s", crate::js::to_fixed(seconds, 1)));
        Value::Object(result)
    }
}
