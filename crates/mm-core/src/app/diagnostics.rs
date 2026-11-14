//! A support report a user can send instead of a round of screenshots (src/diagnostics.ts,
//! src/diagnostics-files.ts, src/diagnostics-render.ts): Dota's own path and language settings,
//! the app's settings and installed mods, the patch and item-table state, a listing of the mod
//! folder's pak files, and the app's own recent log, with what the app itself thinks is wrong.
//!
//! Data in, data out: whoever runs the app hands in what only it knows (the services' answers,
//! the windows, the updater), and decides how the report is packaged.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::js::{number, string, stringify, to_fixed, to_number, truthy};

const NULL: Value = Value::Null;

fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
    v.get(key).unwrap_or(&NULL)
}

/// A value as a template literal writes it: a missing one is "undefined".
fn tpl(v: Option<&Value>) -> String {
    v.map_or_else(|| "undefined".into(), string)
}

/* ---------- what is read off the disk ---------- */

/// One row of a folder listing: its shape, never its bytes.
pub struct Listed {
    pub name: String,
    pub size: u64,
    pub mtime: f64,
    pub dir: bool,
}

fn list_folder(dir: &Path) -> Option<Vec<Listed>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).ok()? {
        let e = e.ok()?;
        let name = e.file_name().to_string_lossy().into_owned();
        let st = std::fs::metadata(dir.join(&name)).ok()?;
        let mtime = st
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0.0, |d| d.as_secs_f64() * 1000.0);
        out.push(Listed { name, size: st.len(), mtime, dir: st.is_dir() });
    }
    out.sort_by(|a, b| crate::js::locale_compare(&a.name, &b.name));
    Some(out)
}

/// The user's home folder.
pub fn home_dir() -> Option<String> {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok().filter(|h| !h.is_empty())
}

/// A folder with the home directory written as ~ (or %USERPROFILE% on Windows).
pub fn redact_home(dir: &str, home: Option<&str>) -> String {
    let Some(home) = home.map(String::from).or_else(home_dir) else { return dir.into() };
    if dir.is_empty() || home.is_empty() {
        return dir.into();
    }
    let (d, h) = if cfg!(windows) { (dir.to_lowercase(), home.to_lowercase()) } else { (dir.into(), home.clone()) };
    let sep = std::path::MAIN_SEPARATOR;
    if d != h && !d.starts_with(&format!("{h}{sep}")) {
        return dir.into();
    }
    let rest: String =
        String::from_utf16_lossy(&dir.encode_utf16().skip(home.encode_utf16().count()).collect::<Vec<_>>());
    if cfg!(windows) {
        format!("%USERPROFILE%{rest}")
    } else {
        format!("~{rest}")
    }
}

fn iso(ms: f64) -> String {
    let ms = ms.trunc() as i64;
    chrono::DateTime::from_timestamp_millis(ms)
        .map_or_else(|| "Invalid Date".into(), |t| t.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// A folder's listing as the text file the report carries.
pub fn folder_listing_text(dir: &Path, filter: Option<&dyn Fn(&Listed) -> bool>, home: Option<&str>) -> String {
    let shown = redact_home(&dir.to_string_lossy(), home);
    let Some(list) = list_folder(dir) else { return format!("{shown}\n(not found or unreadable)") };
    let lines: Vec<String> = list
        .iter()
        .filter(|f| filter.is_none_or(|keep| keep(f)))
        .map(|f| format!("{}{:>10}  {}  {}", if f.dir { "DIR " } else { "    " }, f.size, iso(f.mtime), f.name))
        .collect();
    let body = if lines.is_empty() { "(empty)".to_string() } else { lines.join("\n") };
    format!("{shown}\n\n{body}")
}

/// The last `max_bytes` of a log file, or None when it cannot be read.
pub fn tail_log(file: &Path, max_bytes: u64) -> Option<String> {
    // the size from the open file, so a log replaced in between cannot hand over another's length
    let mut f = std::fs::File::open(file).ok()?;
    let size = f.metadata().ok()?.len();
    let start = size.saturating_sub(max_bytes);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((size - start) as usize);
    f.take(size - start).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

pub fn pak_listed(f: &Listed) -> bool {
    let l = f.name.to_ascii_lowercase();
    let pak = l.strip_prefix("pak").is_some_and(|r| {
        let digits = r.bytes().take_while(u8::is_ascii_digit).count();
        digits > 0 && r.as_bytes().get(digits) == Some(&b'_')
    });
    pak || l.contains("gameinfo")
}

/* ---------- what is wrong, said out loud ---------- */

/// Every check answers one question a support conversation starts with, and carries what to do
/// about it. Two levels on purpose: something is broken, or something is worth knowing.
pub fn find_problems(r: &Value, update_error: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let mut add =
        |level: &str, what: String, detail: String| out.push(json!({ "level": level, "what": what, "detail": detail }));
    let dota = field(r, "dota");
    let settings = field(r, "settings");
    let lang = settings.get("langSuffix");
    if !truthy(field(dota, "path")) {
        add("broken", "Dota 2 not found".into(), "The app has no game path, so nothing can be installed.".into());
    } else if !truthy(field(dota, "pathValid")) {
        add(
            "broken",
            "The game path does not point at Dota 2".into(),
            format!("Set to {}, which has no dota folder inside it.", tpl(dota.get("path"))),
        );
    }
    if truthy(field(dota, "pathValid")) {
        let mounted = field(field(dota, "detectedLang"), "suffix");
        if truthy(mounted) && lang.is_some_and(truthy) && Some(mounted) != lang {
            add(
                "broken",
                "Mods are in a folder the game does not mount".into(),
                format!("The game mounts dota_{}; the app is installing into dota_{}.", string(mounted), tpl(lang)),
            );
        }
        for f in field(dota, "langFolders").as_array().cloned().unwrap_or_default() {
            if f.get("suffix") != lang && to_number(field(&f, "modFiles")) > 0.0 {
                add(
                    "note",
                    format!("{} mod file(s) left behind in dota_{}", tpl(f.get("modFiles")), tpl(f.get("suffix"))),
                    "They are not loaded from there.".into(),
                );
            }
        }
        if !truthy(field(dota, "activeVoiceInstalled")) {
            add(
                "note",
                format!("Voice pack for {} is not installed in Steam", tpl(lang)),
                "The folder the app uses is the one the game mounts; without the voice pack Steam may re-point it."
                    .into(),
            );
        }
    }
    let ps = Some(field(r, "patchAndSchema")).filter(|v| truthy(v)).cloned().unwrap_or_else(|| json!({}));
    if truthy(field(&ps, "error")) {
        add("broken", "The patch/schema state could not be read".into(), string(field(&ps, "error")));
    } else {
        if field(&ps, "patched") == &json!(false) && truthy(field(&ps, "enabled")) {
            add(
                "broken",
                "The game is not patched".into(),
                "Search paths are untouched, so the item table is not mounted.".into(),
            );
        }
        if truthy(field(&ps, "enabled"))
            && truthy(field(&ps, "mods"))
            && (!truthy(field(&ps, "deployed")) || truthy(field(&ps, "stale")))
        {
            add(
                "note",
                "Item-table edits are pending".into(),
                "Mods that add effects or icons will show the model only.".into(),
            );
        }
    }
    let overlaps = field(field(r, "library"), "fileOverlaps");
    if truthy(overlaps) {
        add(
            "note",
            format!("{} mod(s) are overruled by another mod", string(overlaps)),
            "Expected when mods share files; the load order decides.".into(),
        );
    }
    let mirrors = field(r, "mirrors").as_array().cloned().unwrap_or_default();
    let bad: Vec<&Value> = mirrors.iter().filter(|m| to_number(field(m, "fails")) > 0.0).collect();
    let said = || {
        bad.iter().map(|m| format!("{}: {}", tpl(m.get("host")), tpl(m.get("fails")))).collect::<Vec<_>>().join(", ")
    };
    if !bad.is_empty() && bad.len() == mirrors.len() {
        add("broken", "Every download mirror is failing".into(), said());
    } else if !bad.is_empty() {
        add("note", format!("{} download mirror(s) failing", bad.len()), said());
    }
    if truthy(field(r, "dotaRunning")) {
        add("note", "Dota 2 is running".into(), "The app does not write to the game folder while it is.".into());
    }
    let free = field(field(r, "disk"), "freeBytes");
    if truthy(field(r, "disk")) && !free.is_null() && to_number(free) < 2.0 * 1024f64.powi(3) {
        add(
            "broken",
            "Less than 2 GB free on the game drive".into(),
            format!("{} GB left.", to_fixed(to_number(free) / 1024f64.powi(3), 1)),
        );
    }
    if truthy(update_error) {
        add("note", "The updater reported a problem".into(), string(update_error));
    }
    out
}

/* ---------- the report laid out as text ---------- */

fn bytes(n: &Value) -> String {
    if n.is_null() {
        return "?".into();
    }
    let n = to_number(n);
    if n > 1024f64.powi(3) {
        format!("{} GB", to_fixed(n / 1024f64.powi(3), 2))
    } else if n > 1024f64.powi(2) {
        format!("{} MB", to_fixed(n / 1024f64.powi(2), 1))
    } else {
        format!("{} KB", number(crate::js::round(n / 1024.0)))
    }
}

/// The one-screen summary: what is wrong first, then the basics.
pub fn render_summary(r: &Value) -> String {
    let mut l: Vec<String> = Vec::new();
    let yn = |v: &Value| if truthy(v) { "yes" } else { "no" };
    l.push("DOTA 2 MOD MANAGER - SUPPORT SUMMARY".into());
    l.push(format!("Generated {}", tpl(r.get("generatedAt"))));
    l.push(String::new());
    let problems = field(r, "problems").as_array().cloned().unwrap_or_default();
    let broken: Vec<&Value> = problems.iter().filter(|p| field(p, "level") == "broken").collect();
    let notes: Vec<&Value> = problems.iter().filter(|p| field(p, "level") == "note").collect();
    if broken.is_empty() && notes.is_empty() {
        l.push("NOTHING LOOKS WRONG. Every check below passed.".into());
    } else {
        if !broken.is_empty() {
            l.push(format!("BROKEN ({}):", broken.len()));
            for p in &broken {
                l.push(format!("  ! {}\n      {}", tpl(p.get("what")), tpl(p.get("detail"))));
            }
        }
        if !notes.is_empty() {
            l.push(format!("{}WORTH KNOWING ({}):", if broken.is_empty() { "" } else { "\n" }, notes.len()));
            for p in &notes {
                l.push(format!("  - {}\n      {}", tpl(p.get("what")), tpl(p.get("detail"))));
            }
        }
    }
    let app = field(r, "app");
    let dota = field(r, "dota");
    let settings = field(r, "settings");
    let lib = field(r, "library");
    let or_q = |v: &Value| if truthy(v) { string(v) } else { "?".into() };
    l.push(String::new());
    l.push("THE BASICS".into());
    l.push(format!("  App version      {} on {}", tpl(app.get("version")), tpl(app.get("platform"))));
    l.push(format!("  Interface        {}", tpl(app.get("uiLang"))));
    let path = field(dota, "path");
    let shown = if truthy(path) { format!("  ({})", string(path)) } else { String::new() };
    l.push(format!("  Dota found       {}{shown}", yn(field(dota, "pathValid"))));
    l.push(format!("  Mods folder      dota_{}", or_q(field(settings, "langSuffix"))));
    l.push(format!("  Game mounts      dota_{}", or_q(field(field(dota, "detectedLang"), "suffix"))));
    l.push(format!("  Game patched     {}", yn(field(field(r, "patchAndSchema"), "patched"))));
    l.push(format!("  Dota running     {}", yn(field(r, "dotaRunning"))));
    l.push(String::new());
    l.push("WHAT IS INSTALLED".into());
    l.push(format!(
        "  Mods             {} ({} on, {} off)",
        tpl(lib.get("totalRecords")),
        tpl(lib.get("enabled")),
        tpl(lib.get("disabled"))
    ));
    l.push(format!("  Packs            {}", tpl(lib.get("packs"))));
    l.push(format!("  Presets          {}", tpl(lib.get("presets"))));
    let overlaps = field(lib, "fileOverlaps");
    l.push(format!("  Overruled        {}", if overlaps.is_null() { "?".into() } else { string(overlaps) }));
    if let Some(Value::Object(cats)) = lib.get("byCategory") {
        let mut cats: Vec<(&String, &Value)> = crate::js::keys(cats).into_iter().map(|k| (k, &cats[k])).collect();
        cats.sort_by(|a, b| (to_number(b.1) - to_number(a.1)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        if !cats.is_empty() {
            let shown: Vec<String> = cats.iter().take(8).map(|(c, n)| format!("{c} {}", string(n))).collect();
            l.push(format!("  By category      {}", shown.join(", ")));
        }
    }
    let caches = field(r, "caches");
    l.push(String::new());
    l.push("STORAGE".into());
    l.push(format!("  Download cache   {}", bytes(field(caches, "downloadCacheBytes"))));
    l.push(format!("  Icon cache       {}", bytes(field(caches, "iconCacheBytes"))));
    if truthy(field(r, "disk")) {
        l.push(format!("  Free on drive    {}", bytes(field(field(r, "disk"), "freeBytes"))));
    }
    l.push(String::new());
    l.push("Everything above, in full, is in REPORT.md. Send that one to the developer.".into());
    l.join("\n")
}

/// Everything in the report, laid out to be read: REPORT.md.
pub fn render_detailed(r: &Value, files: &IndexMap<String, String>) -> String {
    let mut l: Vec<String> = Vec::new();
    let block = |l: &mut Vec<String>, title: &str, obj: &Value| {
        l.extend([
            format!("## {title}"),
            String::new(),
            "```json".into(),
            stringify(obj, "  "),
            "```".into(),
            String::new(),
        ]);
    };
    let app = field(r, "app");
    l.push(format!("# Diagnostic report - Dota 2 Mod Manager {}", tpl(app.get("version"))));
    l.push(String::new());
    l.push(format!("Generated {}", tpl(r.get("generatedAt"))));
    l.push(String::new());
    l.push("## Verdicts".into());
    l.push(String::new());
    let problems = field(r, "problems").as_array().cloned().unwrap_or_default();
    if problems.is_empty() {
        l.push("Every check passed.".into());
        l.push(String::new());
    }
    for p in &problems {
        let level = if field(p, "level") == "broken" { "BROKEN" } else { "note" };
        l.push(format!("- **{level}** - {}. {}", tpl(p.get("what")), tpl(p.get("detail"))));
    }
    l.push(String::new());
    block(&mut l, "App and system", app);
    block(&mut l, "Settings", field(r, "settings"));
    block(&mut l, "Dota", field(r, "dota"));
    block(&mut l, "Patch and item table", field(r, "patchAndSchema"));
    block(&mut l, "Library", field(r, "library"));
    block(&mut l, "Catalog cache", field(r, "catalogCache"));
    let mut caches = field(r, "caches").as_object().cloned().unwrap_or_default();
    caches.insert("disk".into(), field(r, "disk").clone());
    block(&mut l, "Caches and disk", &Value::Object(caches));
    block(&mut l, "Download mirrors", field(r, "mirrors"));
    for (key, title) in [
        ("windows", "Windows"),
        ("displays", "Displays"),
        ("gpu", "Graphics card"),
        ("rendererErrors", "Errors reported by the interface"),
        ("updater", "Updater"),
        ("remoteConfig", "Remote config"),
        ("toolchain", "Source 2 toolchain"),
        ("compiler", "resourcecompiler.exe"),
    ] {
        if truthy(field(r, key)) {
            block(&mut l, title, field(r, key));
        }
    }
    if truthy(field(r, "installedMods")) {
        l.extend([
            "## Installed mods".into(),
            String::new(),
            "| # | slot | on | category | name |".into(),
            "|---|---|---|---|---|".into(),
        ]);
        for m in field(r, "installedMods").as_array().cloned().unwrap_or_default() {
            let slot = field(&m, "slot");
            let cat = field(&m, "categoryId");
            l.push(format!(
                "| {} | {} | {} | {} | {} |",
                tpl(m.get("i")),
                if slot.is_null() { "-".into() } else { string(slot) },
                if truthy(field(&m, "enabled")) { "on" } else { "off" },
                if truthy(cat) { string(cat) } else { "-".into() },
                tpl(m.get("name")).replace('|', "/")
            ));
        }
        l.push(String::new());
    }
    if !files.is_empty() {
        l.push("## Files in this archive".into());
        l.push(String::new());
        for (n, text) in files {
            l.push(format!("- `{n}` ({})", bytes(&json!(text.len()))));
        }
        l.push(String::new());
    }
    l.join("\n")
}

/* ---------- the report gathered ---------- */

/// What the running app knows and hands in: the services' answers, already asked.
pub struct ReportInputs {
    /// settings.all()
    pub settings: Map<String, Value>,
    /// the library's records, in its order
    pub records: Vec<Value>,
    pub presets: usize,
    /// how many switched-on mods another mod overrules (installer coverage), None when it failed
    pub coverage: Option<f64>,
    /// each record's slot number, None where it has none or the question failed
    pub slots: Vec<Option<f64>>,
    pub download_cache: Value,
    /// the icon cache's size, None when there are no icons
    pub icon_size: Option<Value>,
    /// the schema service's state, or why it could not be read
    pub schema_state: Result<Value, String>,
    pub catalog_cache: Value,
    pub mirrors: Value,
    pub version: String,
    pub platform: String,
    pub node: String,
    pub log_file: Option<String>,
    pub user_data_dir: Option<String>,
    pub update_error: Value,
    /// dotaRunning, windows, rendererErrors, updater, remoteConfig, toolchain, compiler, displays, gpu
    pub extra: Map<String, Value>,
    pub home: Option<String>,
    pub generated_at: String,
}

/// Everything a support report carries: report.json, and the plain-text files beside it by name.
pub fn build_report(i: ReportInputs) -> (Value, IndexMap<String, String>) {
    let s = i.settings;
    let game = s.get("dotaGamePath").and_then(Value::as_str).filter(|g| !g.is_empty()).map(String::from);
    let game_path = game.as_deref().map(Path::new);
    let valid = game_path.is_some_and(crate::installer::validate_game_path);
    let active = s.get("langSuffix").cloned().unwrap_or(Value::Null);
    let active_s = active.as_str().filter(|a| !a.is_empty()).map(String::from);
    let home = i.home.as_deref();

    let mut by_category = Map::new();
    for r in &i.records {
        let k = tpl(r.get("categoryId"));
        let n = by_category.get(&k).map_or(0.0, to_number);
        by_category.insert(k, crate::js::json_number(n + 1.0));
    }

    let mut settings = s.clone();
    if let Some(Value::String(p)) = s.get("dotaGamePath") {
        settings.insert("dotaGamePath".into(), json!(redact_home(p, home)));
    }
    let account = field(&Value::Object(s.clone()), "account").clone();
    settings.insert(
        "account".into(),
        if truthy(&account) {
            let user = field(&account, "username");
            json!({ "signedIn": true, "username": if truthy(user) { user.clone() } else { Value::Null } })
        } else {
            Value::Null
        },
    );

    let boot = if valid { crate::gamelang::boot_languages(game_path) } else { None };
    let dota = json!({
        "path": game.as_deref().map(|g| redact_home(g, home)).filter(|p| !p.is_empty()),
        "pathValid": valid,
        "detectedLang": if valid { serde_json::to_value(crate::gamelang::detect_lang_suffix(game_path)).unwrap_or(Value::Null) } else { Value::Null },
        "bootLanguages": if valid { boot.map_or(Value::Null, |(ui, audio)| json!({ "ui": ui, "audio": audio })) } else { Value::Null },
        "steamLanguage": if valid { json!(crate::gamelang::steam_language(game_path)) } else { Value::Null },
        "langFolders": if valid { serde_json::to_value(crate::gamelang::lang_folders(game_path)).unwrap_or(json!([])) } else { json!([]) },
        "activeVoiceInstalled": match (valid, game_path, &active_s) {
            (true, Some(g), Some(a)) => crate::gamelang::voice_installed(g, a),
            _ => false,
        },
        "minifyDetected": valid && game_path.is_some_and(|g| g.join("dota_minify").exists()),
    });

    let enabled = |r: &Value| field(r, "enabled") != &json!(false);
    let library = json!({
        "totalRecords": i.records.len(),
        "byCategory": by_category,
        "enabled": i.records.iter().filter(|r| enabled(r)).count(),
        "disabled": i.records.iter().filter(|r| !enabled(r)).count(),
        "packs": i.records.iter().filter(|r| field(r, "kind") == "pack").count(),
        "withSchemaEdits": i.records.iter().filter(|r| field(r, "schema").as_array().is_some_and(|a| !a.is_empty())).count(),
        "presets": i.presets,
        "fileOverlaps": i.coverage.map(crate::js::json_number),
    });

    // room on the drive the game is on: "the install failed" and "there is no space" look alike
    let disk_at = if valid { game.clone().unwrap_or_default() } else { home_dir().unwrap_or_default() };
    let disk = match (fs4::available_space(&disk_at), fs4::total_space(&disk_at)) {
        (Ok(free), Ok(total)) => json!({ "freeBytes": free, "totalBytes": total }),
        _ => Value::Null,
    };

    // every mod in load order, one line each
    let mut mods: Vec<Value> = i
        .records
        .iter()
        .enumerate()
        .map(|(k, r)| {
            let cat = field(r, "categoryId");
            let kind = field(r, "kind");
            json!({
                "i": 0,
                "slot": i.slots.get(k).copied().flatten().map(crate::js::json_number),
                "name": field(r, "name"),
                "categoryId": if truthy(cat) { cat.clone() } else { Value::Null },
                "enabled": enabled(r),
                "kind": if truthy(kind) { kind.clone() } else { json!("mod") },
                "files": field(r, "files").as_array().map_or(0, Vec::len),
            })
        })
        .collect();
    let slot_of = |m: &Value| m["slot"].as_f64().unwrap_or(1e9);
    mods.sort_by(|a, b| (slot_of(a) - slot_of(b)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    for (k, m) in mods.iter_mut().enumerate() {
        m["i"] = json!(k + 1);
    }

    let extra = |k: &str| i.extra.get(k).filter(|v| truthy(v)).cloned().unwrap_or(Value::Null);
    let mut report = json!({
        "generatedAt": i.generated_at,
        "app": { "version": i.version, "platform": i.platform, "node": i.node, "uiLang": s.get("uiLang").cloned().unwrap_or(Value::Null) },
        "settings": settings,
        "dota": dota,
        "patchAndSchema": match &i.schema_state { Ok(v) => v.clone(), Err(e) => json!({ "error": e }) },
        "mirrors": i.mirrors,
        "library": library,
        "catalogCache": i.catalog_cache,
        "caches": { "downloadCacheBytes": i.download_cache, "iconCacheBytes": i.icon_size.unwrap_or(Value::Null) },
        "disk": disk,
        "installedMods": mods,
        "dotaRunning": truthy(i.extra.get("dotaRunning").unwrap_or(&NULL)),
        "windows": extra("windows"),
        "rendererErrors": extra("rendererErrors"),
        "updater": extra("updater"),
        "remoteConfig": extra("remoteConfig"),
        "toolchain": extra("toolchain"),
        "compiler": extra("compiler"),
        "displays": extra("displays"),
        "gpu": extra("gpu"),
    });
    let problems = find_problems(&report, &i.update_error);
    report["problems"] = Value::Array(problems);

    let mut files = IndexMap::new();
    if let (true, Some(g), Some(a)) = (valid, game_path, &active_s) {
        files.insert("mod-folder-listing.txt".into(), folder_listing_text(&g.join(format!("dota_{a}")), None, None));
        files.insert("dota-pak-listing.txt".into(), folder_listing_text(&g.join("dota"), Some(&pak_listed), None));
        // the two files the patch edits, verbatim
        for name in ["gameinfo.gi", "gameinfo_branchspecific.gi"] {
            if let Some(text) = tail_log(&g.join("dota").join(name), 64 * 1024).filter(|t| !t.is_empty()) {
                files.insert(format!("dota/{name}"), text);
            }
        }
        if let Some(text) = tail_log(&g.join("dota").join("cfg").join("boot.vcfg"), 16 * 1024).filter(|t| !t.is_empty())
        {
            files.insert("dota/boot.vcfg".into(), text);
        }
        if let Some(text) = tail_log(&g.join("dota").join("console.log"), 256 * 1024).filter(|t| !t.is_empty()) {
            files.insert("dota/console.log".into(), text);
        }
    }
    if let Some(log) = i.log_file.as_deref().filter(|l| !l.is_empty()) {
        if let Some(text) = tail_log(Path::new(log), 400 * 1024).filter(|t| !t.is_empty()) {
            files.insert("app.log".into(), text);
        }
        if let Some(text) = tail_log(Path::new(&format!("{log}.1")), 200 * 1024).filter(|t| !t.is_empty()) {
            files.insert("app.previous.log".into(), text);
        }
    }
    if let Some(ud) = i.user_data_dir.as_deref().filter(|u| !u.is_empty()) {
        let ud = Path::new(ud);
        files.insert("userdata-listing.txt".into(), folder_listing_text(ud, None, home));
        files.insert("downloads-listing.txt".into(), folder_listing_text(&ud.join("downloads"), None, home));
        files.insert("backups-listing.txt".into(), folder_listing_text(&ud.join("backups"), None, home));
    }
    (report, files)
}
