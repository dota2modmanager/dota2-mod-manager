//! Hero grids for the pick screen out of this patch's numbers (issue #428).
//!
//! The game keeps the grids in Steam's folder for the account, not in the game:
//! userdata/<account>/570/remote/cfg/hero_grid_config.json. That makes them safe in any mode: no
//! pak, no search path, nothing Valve checks. The numbers are OpenDota's public heroStats: picks
//! and wins per rank bracket, for the matches of the last days.
//!
//! The file holds the user's own grids too, so the app never replaces it. It adds its grids as
//! configs whose name starts with GRID_PREFIX, puts them back on the next apply, and takes only
//! those away on "remove". The file as it was before the first write is kept in userData anyway.

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::js::{json_number, round, string, to_number, truthy};
use crate::net_fetch::Net;

/// Where the numbers come from.
pub const HERO_STATS_API: &str = "https://api.opendota.com/api/heroStats";
/// The site's daily copy of the same list (site/tools/mirror.mjs): OpenDota's host does not open
/// for a good part of the players in Russia, and the grid button then had nothing to build from.
pub const HERO_STATS_COPY: &str = "https://dota2modmanager.com/mirror/hero-stats.json";
/// How the app's grids are told apart from the user's in the same file.
pub const GRID_PREFIX: &str = "D2MM · ";
/// The grids the app can make.
pub const GRID_KINDS: [&str; 3] = ["winrate", "attribute", "popular"];

const NULL: Value = Value::Null;

fn field<'a>(h: &'a Value, key: &str) -> &'a Value {
    h.get(key).unwrap_or(&NULL)
}

/* Picks and wins across every bracket. Older answers had pub_pick/pub_win; the current one has
 * them per bracket only ("1_pick" .. "8_pick"), so the sum is the same number either way. */
fn totals(h: &Value) -> (f64, f64) {
    if let (Some(p), Some(w)) = (field(h, "pub_pick").as_f64(), field(h, "pub_win").as_f64()) {
        if p > 0.0 {
            return (p, w);
        }
    }
    let or0 = |v: f64| if v.is_nan() { 0.0 } else { v };
    let (mut picks, mut wins) = (0.0, 0.0);
    for b in 1..=8 {
        picks += or0(to_number(field(h, &format!("{b}_pick"))));
        wins += or0(to_number(field(h, &format!("{b}_win"))));
    }
    (picks, wins)
}

/// Win rate as a fraction, 0 for a hero nobody picked.
fn win_rate(h: &Value) -> f64 {
    let (picks, wins) = totals(h);
    if picks != 0.0 && !picks.is_nan() {
        wins / picks
    } else {
        0.0
    }
}

/* The canvas the pick screen gives a grid is about 1200 by 600, and the game shrinks portraits to
 * fit the box a category is given. Each category is one band across the full width; the height is
 * shared out by how many rows each band needs at full size, so the bands fill the canvas and none
 * spills off it. */
const WIDTH: f64 = 1180.0;
const HEIGHT: f64 = 560.0;
const CELL_W: f64 = 52.0;
const GAP: f64 = 16.0;

fn layout(bands: Vec<(String, Vec<Value>)>) -> Vec<Value> {
    let used: Vec<_> = bands.into_iter().filter(|b| !b.1.is_empty()).collect();
    let per_row = (WIDTH / CELL_W).floor();
    let rows: Vec<f64> = used.iter().map(|b| (b.1.len() as f64 / per_row).ceil()).collect();
    let unit = (HEIGHT - GAP * (used.len() as f64 - 1.0)) / rows.iter().sum::<f64>();
    let mut y = 0.0;
    used.into_iter()
        .enumerate()
        .map(|(i, (name, ids))| {
            let height = round(rows[i] * unit);
            let cat = json!({
                "category_name": name, "x_position": 0, "y_position": json_number(y),
                "width": json_number(WIDTH), "height": json_number(height), "hero_ids": ids,
            });
            y += height + GAP;
            cat
        })
        .collect()
}

fn by_win_rate(a: &Value, b: &Value) -> Ordering {
    (win_rate(b) - win_rate(a)).partial_cmp(&0.0).unwrap_or(Ordering::Equal)
}

/// The name a grid of this kind carries in the pick screen, in the app's language.
pub fn grid_name(kind: &str) -> String {
    let name = match kind {
        "winrate" => t("Процент побед", &[]),
        "attribute" => t("По атрибутам", &[]),
        _ => t("Чаще всего берут", &[]),
    };
    format!("{GRID_PREFIX}{name}")
}

fn ids(list: &[&Value]) -> Vec<Value> {
    list.iter().map(|h| field(h, "id").clone()).collect()
}

/// The grid of one kind out of heroStats: its name in the file and its categories.
pub fn build_grid(stats: &[Value], kind: &str) -> Value {
    let heroes: Vec<&Value> = stats
        .iter()
        .filter(|h| {
            field(h, "id").as_f64().is_some_and(|id| id.is_finite() && id.fract() == 0.0 && id > 0.0)
                && totals(h).0 > 0.0
        })
        .collect();
    let categories = match kind {
        "winrate" => {
            let tiers = [(0.53, 1.01), (0.51, 0.53), (0.49, 0.51), (0.47, 0.49), (0.0, 0.47)];
            let names = [
                t("Выше {0}", &[json!("53%")]),
                "51–53%".into(),
                "49–51%".into(),
                "47–49%".into(),
                t("Ниже {0}", &[json!("47%")]),
            ];
            layout(
                tiers
                    .iter()
                    .zip(names)
                    .map(|(&(lo, hi), name)| {
                        let these = heroes.iter().copied().filter(|h| win_rate(h) >= lo && win_rate(h) < hi).collect();
                        (name, {
                            let mut these: Vec<&Value> = these;
                            these.sort_by(|a, b| by_win_rate(a, b));
                            ids(&these)
                        })
                    })
                    .collect(),
            )
        }
        "attribute" => {
            let attrs = [("str", "Сила"), ("agi", "Ловкость"), ("int", "Интеллект"), ("all", "Универсальные")];
            layout(
                attrs
                    .iter()
                    .map(|&(a, name)| {
                        let these =
                            heroes.iter().copied().filter(|h| field(h, "primary_attr").as_str() == Some(a)).collect();
                        (t(name, &[]), {
                            let mut these: Vec<&Value> = these;
                            these.sort_by(|a, b| by_win_rate(a, b));
                            ids(&these)
                        })
                    })
                    .collect(),
            )
        }
        _ => {
            let mut popular = heroes.clone();
            popular.sort_by(|a, b| (totals(b).0 - totals(a).0).partial_cmp(&0.0).unwrap_or(Ordering::Equal));
            let cut = |from: usize, to: usize| ids(&popular[from.min(popular.len())..to.min(popular.len())]);
            layout(vec![
                (t("Топ {0}", &[json!(20)]), cut(0, 20)),
                (t("Следом", &[]), cut(20, 60)),
                (t("Реже всех", &[]), cut(60, usize::MAX)),
            ])
        }
    };
    json!({ "config_name": grid_name(kind), "categories": categories })
}

fn config_name(c: &Value) -> Result<String, String> {
    match c {
        Value::Null => Err("Cannot read properties of null (reading 'config_name')".into()),
        _ => Ok(c.get("config_name").filter(|v| truthy(v)).map(string).unwrap_or_default()),
    }
}

/// The file with the app's grids swapped for these; the user's configs and anything else stay.
pub fn merge_grids(existing: Option<&str>, ours: Vec<Value>) -> Result<String, String> {
    let mut file = json!({ "version": 3, "configs": [] });
    if let Some(text) = existing.filter(|s| !s.is_empty()) {
        let parsed: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        if !parsed.get("configs").is_some_and(Value::is_array) || parsed.is_array() {
            return Err(t("Файл сеток героев не похож на файл игры", &[]));
        }
        file = parsed;
    }
    let mut theirs = Vec::new();
    for c in file["configs"].as_array().cloned().unwrap_or_default() {
        if !config_name(&c)?.starts_with(GRID_PREFIX) {
            theirs.push(c);
        }
    }
    theirs.extend(ours);
    file["configs"] = Value::Array(theirs);
    Ok(format!("{}\n", crate::js::stringify(&file, "\t")))
}

/// The grid file of the account, under a Steam account folder (userdata/<id>).
pub fn grid_file(account_dir: &Path) -> PathBuf {
    account_dir.join("570").join("remote").join("cfg").join("hero_grid_config.json")
}

/// Which of the app's grids are in a grid file now, by config name.
pub fn grids_in(text: Option<&str>) -> Vec<String> {
    let Some(text) = text.filter(|s| !s.is_empty()) else { return vec![] };
    let Ok(file) = serde_json::from_str::<Value>(text) else { return vec![] };
    let configs = match file.get("configs") {
        _ if file.is_null() => return vec![],
        Some(Value::Array(a)) => a.clone(),
        Some(v) if truthy(v) => return vec![],
        _ => vec![],
    };
    let mut out = Vec::new();
    for c in &configs {
        let Ok(n) = config_name(c) else { return vec![] };
        if n.starts_with(GRID_PREFIX) {
            out.push(n);
        }
    }
    out
}

fn count(v: &Value) -> f64 {
    let n = to_number(v);
    if n.is_finite() && n >= 0.0 {
        n.floor()
    } else {
        0.0
    }
}

/// heroStats cut to the numbers a grid reads, so what is kept on disk is ours and nothing else.
pub fn keep_numbers(raw: &Value) -> Vec<Value> {
    let Some(list) = raw.as_array() else { return vec![] };
    let mut out = Vec::new();
    for h in list {
        if !h.is_object() {
            continue;
        }
        let id = count(field(h, "id"));
        if id == 0.0 {
            continue;
        }
        let mut kept = Map::new();
        kept.insert("id".into(), json_number(id));
        let attr = string(field(h, "primary_attr"));
        if h.get("primary_attr").is_some() && ["str", "agi", "int", "all"].contains(&attr.as_str()) {
            kept.insert("primary_attr".into(), json!(attr));
        }
        kept.insert("pub_pick".into(), json_number(count(field(h, "pub_pick"))));
        kept.insert("pub_win".into(), json_number(count(field(h, "pub_win"))));
        for b in 1..=8 {
            for k in [format!("{b}_pick"), format!("{b}_win")] {
                let n = count(field(h, &k));
                kept.insert(k, json_number(n));
            }
        }
        out.push(Value::Object(kept));
    }
    out
}

fn read_or_none(file: &Path) -> Option<String> {
    std::fs::read(file).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// The grids for one account: the numbers fetched (and cached in userData, so a down API still
/// leaves the last ones), the file written with a backup of how it was first.
pub struct HeroGrids {
    /// where the cache and the backup live (userData/hero-grid)
    pub data_dir: PathBuf,
    /// the logged-in account's userdata folder, or None when Steam has none
    pub account_dir: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
    /// every account on this machine that has played Dota, for "write into all accounts"
    pub all_accounts: Box<dyn Fn() -> Vec<PathBuf> + Send + Sync>,
    pub net: Arc<Net>,
    pub api: String,
    /// asked when `api` does not answer
    pub copy: Option<String>,
    pub now: Box<dyn Fn() -> f64 + Send + Sync>,
}

impl HeroGrids {
    fn cache_file(&self) -> PathBuf {
        self.data_dir.join("hero-stats.json")
    }

    /// The cached numbers and when they came, if any came.
    fn cached(&self) -> Option<Value> {
        let text = read_or_none(&self.cache_file())?;
        serde_json::from_str::<Value>(&text).ok().filter(|v| !v.is_null())
    }

    fn fetch(&self) -> Result<Vec<Value>, String> {
        let first = self.fetch_from(&self.api);
        match (&first, &self.copy) {
            (Err(why), Some(copy)) => self.fetch_from(copy).map_err(|_| why.clone()),
            _ => first,
        }
    }

    fn fetch_from(&self, url: &str) -> Result<Vec<Value>, String> {
        let (status, body) = self.net.direct("GET", url, &[], None, 15000).map_err(|e| e.message.clone())?;
        if !(200..300).contains(&status) {
            return Err(format!("HTTP {status}"));
        }
        let raw: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        let stats = keep_numbers(&raw);
        if stats.len() < 100 {
            return Err(t("OpenDota прислал не список героев", &[]));
        }
        Ok(stats)
    }

    fn fresh_stats(&self) -> Result<(Value, Value), String> {
        let got = self.fetch().and_then(|stats| {
            let got = json!({ "at": json_number((self.now)()), "stats": stats });
            std::fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
            crate::atomic_file::write_file_atomic(&self.cache_file(), crate::js::stringify(&got, "").as_bytes())
                .map_err(|e| e.to_string())?;
            Ok(got)
        });
        let got = match got {
            Ok(g) => g,
            Err(why) => match self.cached().filter(truthy) {
                Some(old) => old,
                None => return Err(t("Не удалось получить статистику OpenDota: {0}", &[json!(why)])),
            },
        };
        Ok((field(&got, "at").clone(), field(&got, "stats").clone()))
    }

    fn prefs_file(&self) -> PathBuf {
        self.data_dir.join("prefs.json")
    }

    /// Whether the grids go into every account that has played Dota, not only the signed-in one.
    pub fn all(&self) -> bool {
        read_or_none(&self.prefs_file())
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .is_some_and(|p| p.get("all").and_then(Value::as_bool) == Some(true))
    }

    /// The accounts a write goes to: all of them with the switch on, else the signed-in one.
    fn targets(&self) -> Vec<PathBuf> {
        if self.all() {
            (self.all_accounts)()
        } else {
            (self.account_dir)().into_iter().collect()
        }
    }

    /// Our grids in one account's file, by kind.
    fn kinds_in(dir: &Path) -> Vec<&'static str> {
        let names = grids_in(read_or_none(&grid_file(dir)).as_deref());
        GRID_KINDS.iter().copied().filter(|k| names.contains(&grid_name(k))).collect()
    }

    /// What the settings row shows: whose file, which of our grids it has, how old the numbers are.
    /// The switches follow the signed-in account; with no one signed in, the first of all accounts.
    pub fn state(&self) -> Value {
        let all = self.all();
        let accounts = (self.all_accounts)();
        let dir = (self.account_dir)().or_else(|| if all { accounts.first().cloned() } else { None });
        let kinds = dir.as_deref().map(Self::kinds_in).unwrap_or_default();
        let at = self.cached().and_then(|c| c.get("at").cloned()).unwrap_or(Value::Null);
        json!({ "account": dir.is_some(), "kinds": kinds, "statsAt": at, "all": all, "accounts": accounts.len() })
    }

    /// Write the grids of these kinds into the account's file (or every account's), in place of
    /// the app's old ones.
    pub fn apply(&self, kinds: &[String]) -> Result<Value, String> {
        let targets = self.targets();
        if targets.is_empty() {
            return Err(t("Не нашёл аккаунт Steam, в который заходила Dota 2", &[]));
        }
        let (at, stats) = self.fresh_stats()?;
        let Some(stats) = stats.as_array() else { return Err("stats.filter is not a function".into()) };
        let wanted: Vec<&str> = GRID_KINDS.iter().copied().filter(|k| kinds.iter().any(|x| x == k)).collect();
        let grids: Vec<Value> = wanted.iter().map(|k| build_grid(stats, k)).collect();
        for dir in &targets {
            self.write_into(dir, grids.clone())?;
        }
        Ok(json!({ "kinds": wanted, "statsAt": at }))
    }

    /// One account's file with the app's grids swapped for these, backed up the first time.
    fn write_into(&self, dir: &Path, grids: Vec<Value>) -> Result<(), String> {
        let file = grid_file(dir);
        let before = read_or_none(&file);
        let account = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let backup = self.data_dir.join(format!("hero_grid_config.{account}.backup.json"));
        std::fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
        // written once, the first time, and never over a backup that is already there
        if let Some(b) = &before {
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&backup) {
                Ok(mut f) => std::io::Write::write_all(&mut f, b.as_bytes()).map_err(|e| e.to_string())?,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let text = merge_grids(before.as_deref(), grids)?;
        crate::atomic_file::write_file_atomic(&file, text.as_bytes()).map_err(|e| e.to_string())
    }

    /// The app's grids out of one account's file; the user's stay. A file without ours is left be.
    fn clear(dir: &Path) -> Result<(), String> {
        let file = grid_file(dir);
        if let Some(b) = read_or_none(&file).filter(|b| !grids_in(Some(b)).is_empty()) {
            let text = merge_grids(Some(&b), vec![])?;
            crate::atomic_file::write_file_atomic(&file, text.as_bytes()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Take the app's grids out and leave the user's (out of every account with the switch on).
    pub fn remove(&self) -> Result<Value, String> {
        for dir in self.targets() {
            Self::clear(&dir)?;
        }
        Ok(json!({ "kinds": [] }))
    }

    /// The "all accounts" switch. On: the grids the signed-in account has go into every account.
    /// Off: they stay only in the signed-in one, and the others lose the app's grids.
    pub fn set_all(&self, on: bool) -> Result<Value, String> {
        let current = (self.account_dir)();
        let kinds: Vec<String> = current
            .as_deref()
            .map(Self::kinds_in)
            .or_else(|| (self.all_accounts)().first().map(|d| Self::kinds_in(d)))
            .unwrap_or_default()
            .into_iter()
            .map(String::from)
            .collect();
        let save = |all: bool| {
            std::fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
            crate::atomic_file::write_file_atomic(&self.prefs_file(), json!({ "all": all }).to_string().as_bytes())
                .map_err(|e| e.to_string())
        };
        save(on)?;
        if on {
            if !kinds.is_empty() {
                // a switch that could not write stays off, so it never shows what the files are not
                if let Err(why) = self.apply(&kinds) {
                    let _ = save(false);
                    return Err(why);
                }
            }
        } else {
            for dir in (self.all_accounts)() {
                if current.as_ref() != Some(&dir) {
                    Self::clear(&dir)?;
                }
            }
        }
        Ok(json!({ "all": on }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_users_own_grid_stays_and_ours_is_swapped() {
        let mine = r#"{"version":3,"configs":[{"config_name":"Mine","categories":[]},{"config_name":"D2MM · old","categories":[]}]}"#;
        let out = merge_grids(Some(mine), vec![json!({"config_name": "D2MM · new", "categories": []})]).unwrap();
        assert_eq!(grids_in(Some(&out)), vec!["D2MM · new".to_string()]);
        assert!(out.contains("\"Mine\""));
    }

    /// Serves one GET with `body` on 127.0.0.1.
    fn serve_once(body: String) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/hero-stats.json", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let _ = sock.read(&mut buf);
            let head = format!(
                "HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: {}
Connection: close

",
                body.len()
            );
            sock.write_all(head.as_bytes()).unwrap();
            sock.write_all(body.as_bytes()).unwrap();
        });
        url
    }

    #[test]
    fn the_all_accounts_switch_copies_the_grids_into_every_account_and_takes_them_back() {
        let dir = std::env::temp_dir().join(format!("mm-hero-grid-{}", uuid::Uuid::new_v4().simple()));
        let (me, alt) = (dir.join("userdata").join("111"), dir.join("userdata").join("222"));
        let data = dir.join("hero-grid");
        std::fs::create_dir_all(&data).unwrap();
        // cached numbers, so the dead API below costs nothing
        let heroes: Vec<Value> =
            (1..=120).map(|id| json!({ "id": id, "primary_attr": "str", "pub_pick": 10, "pub_win": 5 })).collect();
        std::fs::write(data.join("hero-stats.json"), json!({ "at": 1, "stats": heroes }).to_string()).unwrap();
        let theirs = r#"{"version":3,"configs":[{"config_name":"Mine","categories":[]}]}"#;
        std::fs::create_dir_all(grid_file(&alt).parent().unwrap()).unwrap();
        std::fs::write(grid_file(&alt), theirs).unwrap();
        let dead = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}/api/heroStats", l.local_addr().unwrap())
        };
        let (m, a) = (me.clone(), vec![me.clone(), alt.clone()]);
        let grids = HeroGrids {
            data_dir: data,
            account_dir: Box::new(move || Some(m.clone())),
            all_accounts: Box::new(move || a.clone()),
            net: Arc::new(Net::new(|| 0.0)),
            api: dead,
            copy: None,
            now: Box::new(|| 2.0),
        };
        let ours = |d: &Path| grids_in(read_or_none(&grid_file(d)).as_deref());
        let check = || -> Result<(), String> {
            grids.apply(&["winrate".into()])?;
            assert_eq!(ours(&me).len(), 1);
            assert!(ours(&alt).is_empty(), "the switch is off: only the signed-in account");
            grids.set_all(true)?;
            assert_eq!(ours(&alt), vec![grid_name("winrate")], "switched on: the other account gets the same grids");
            assert!(read_or_none(&grid_file(&alt)).unwrap().contains("\"Mine\""), "and keeps its own");
            assert_eq!(grids.state()["all"], json!(true));
            grids.set_all(false)?;
            assert!(ours(&alt).is_empty(), "switched off: the other account loses ours");
            assert_eq!(ours(&me).len(), 1, "the signed-in one keeps them");
            Ok(())
        };
        let got = check();
        let _ = std::fs::remove_dir_all(&dir);
        got.unwrap();
    }

    #[test]
    fn an_unreachable_opendota_falls_back_to_the_sites_copy() {
        let heroes: Vec<Value> =
            (1..=120).map(|id| json!({ "id": id, "primary_attr": "str", "pub_pick": 10, "pub_win": 5 })).collect();
        let copy = serve_once(Value::Array(heroes).to_string());
        // nothing listens on the port a closed listener left
        let dead = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}/api/heroStats", l.local_addr().unwrap())
        };
        let dir = std::env::temp_dir().join(format!("mm-hero-grid-{}", uuid::Uuid::new_v4().simple()));
        let grids = HeroGrids {
            data_dir: dir.clone(),
            account_dir: Box::new(|| None),
            all_accounts: Box::new(Vec::new),
            net: Arc::new(Net::new(|| 0.0)),
            api: dead,
            copy: Some(copy),
            now: Box::new(|| 1.0),
        };
        let got = grids.fresh_stats();
        let _ = std::fs::remove_dir_all(&dir);
        let (_, stats) = got.unwrap();
        assert_eq!(stats.as_array().map(Vec::len), Some(120));
    }
}
