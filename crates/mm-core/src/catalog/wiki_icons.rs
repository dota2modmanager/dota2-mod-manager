//! Pictures off the Dota wikis (src/icons.ts and src/icon-wiki.ts), for cosmetics the game keeps
//! no usable picture of and for mods the app can only name by their hero. Fandom hosts a PNG for
//! most cosmetics under a name built from the item's own and answers only a browser's agent;
//! Liquipedia, asked only when Fandom has nothing at all, wants an agent naming the project and
//! one request every two seconds. Everything is cached on disk, misses included, so a slot of
//! 2000 loading screens is not 2000 requests each time the picker opens. A wiki that did not
//! answer is never remembered as a "no".

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use indexmap::IndexMap;
use serde_json::Value;
use sha1::{Digest, Sha1};

use crate::icon_match::{cosmetic_file_names, hero_file_names, pick_title, prefix_of, sniff, strip_screen_suffix};
use crate::net_fetch::Net;

const WIKI: &str = "https://dota2.fandom.com/wiki/Special:FilePath/";
const API: &str = "https://dota2.fandom.com/api.php";
// Fandom answers 403 without a browser agent
const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const LIQ_API: &str = "https://liquipedia.net/commons/api.php";
const LIQ_MIN_GAP: Duration = Duration::from_millis(2100);
const MAX_BYTES: usize = 512 * 1024;
/// retry a missing picture next week, not next second
const MISS_TTL_MS: f64 = 7.0 * 24.0 * 3600.0 * 1000.0;
/// the wiki starts refusing a burst of a hundred, and a refusal used to be remembered as a miss
const CONCURRENCY: usize = 6;
const TIMEOUT_MS: u64 = 20_000;

/// What one ask came to: the picture, a sure "there is none", or no answer.
enum Got {
    Hit(Vec<u8>, &'static str),
    No,
    Silent,
}

/// Where a wiki keeps an item's picture, when the game's own name is not the file's.
enum Found {
    Fandom(String),
    Liquipedia(String),
}

/// The stand-ins for a kind of content the app cannot name more closely (src/icons.ts GENERIC_PAGES).
const GENERIC_PAGES: &[(&str, &str)] = &[("pack", "DAC Compendium 2015 Emoticon Pack"), ("cursor", "Cursor Pack")];

/// Pictures off the wikis, cached in userData/icons.
pub struct WikiIcons {
    dir: PathBuf,
    miss_file: PathBuf,
    misses: Mutex<HashMap<String, f64>>,
    net: Arc<Net>,
    now: fn() -> f64,
    liq_ua: String,
    /// when the last request to Liquipedia ended; held through each request
    liq_gate: Mutex<Option<Instant>>,
}

/// encodeURIComponent.
fn uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

impl WikiIcons {
    pub fn new(user_data: &std::path::Path, net: Arc<Net>, now: fn() -> f64, app_version: &str) -> WikiIcons {
        let dir = user_data.join("icons");
        // v6: the older files hold names that missed before the exact title's own page was tried
        let miss_file = dir.join("misses.v6.json");
        let misses = std::fs::read_to_string(&miss_file)
            .ok()
            .and_then(|t| serde_json::from_str::<HashMap<String, f64>>(&t).ok())
            .unwrap_or_default();
        WikiIcons {
            dir,
            miss_file,
            misses: Mutex::new(misses),
            net,
            now,
            liq_ua: format!("Dota2ModManager/{app_version} (+https://github.com/dota2modmanager/dota2-mod-manager)"),
            liq_gate: Mutex::new(None),
        }
    }

    fn cache_path(&self, key: &str) -> PathBuf {
        let hex: String = Sha1::digest(key.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
        self.dir.join(format!("{}.img", &hex[..16]))
    }

    fn data_uri(buf: &[u8], mime: &str) -> String {
        format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(buf))
    }

    fn save_misses(&self, misses: &HashMap<String, f64>) {
        let _ = std::fs::create_dir_all(&self.dir);
        let _ = std::fs::write(&self.miss_file, serde_json::to_string(misses).unwrap_or_default());
    }

    /// The disk cache and the misses around one lookup.
    fn cached(&self, key: &str, resolve: impl FnOnce() -> Got) -> Option<String> {
        let file = self.cache_path(key);
        if let Ok(buf) = std::fs::read(&file) {
            if let Some(mime) = sniff(&buf) {
                return Some(Self::data_uri(&buf, mime));
            }
        }
        let missed = self.misses.lock().unwrap_or_else(|e| e.into_inner()).get(key).copied();
        if missed.is_some_and(|at| (self.now)() - at < MISS_TTL_MS) {
            return None;
        }
        match resolve() {
            Got::Hit(buf, mime) => {
                let _ = std::fs::create_dir_all(&self.dir);
                let _ = std::fs::write(&file, &buf);
                let mut m = self.misses.lock().unwrap_or_else(|e| e.into_inner());
                if m.remove(key).is_some() {
                    self.save_misses(&m);
                }
                Some(Self::data_uri(&buf, mime))
            }
            Got::No => {
                let mut m = self.misses.lock().unwrap_or_else(|e| e.into_inner());
                m.insert(key.to_string(), (self.now)());
                self.save_misses(&m);
                None
            }
            Got::Silent => None,
        }
    }

    /// Liquipedia's turn: one request at a time, two seconds apart.
    fn liq_turn<T>(&self, call: impl FnOnce() -> T) -> T {
        let mut last = self.liq_gate.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(at) = *last {
            let since = at.elapsed();
            if since < LIQ_MIN_GAP {
                std::thread::sleep(LIQ_MIN_GAP - since);
            }
        }
        let out = call();
        *last = Some(Instant::now());
        out
    }

    /// A MediaWiki API answer, or None when the wiki did not answer at all.
    fn ask(&self, api: &str, ua: &str, params: &[(&str, &str)]) -> Option<Value> {
        let mut q = url::form_urlencoded::Serializer::new(String::new());
        q.append_pair("format", "json");
        for (k, v) in params {
            q.append_pair(k, v);
        }
        let url = format!("{api}?{}", q.finish());
        let (status, body) = self.net.direct("GET", &url, &[("User-Agent", ua)], None, TIMEOUT_MS).ok()?;
        if !(200..300).contains(&status) {
            return None;
        }
        serde_json::from_slice(&body).ok()
    }

    fn ask_fandom(&self, params: &[(&str, &str)]) -> Option<Value> {
        self.ask(API, UA, params)
    }

    fn ask_liquipedia(&self, params: &[(&str, &str)]) -> Option<Value> {
        let ua = self.liq_ua.clone();
        self.liq_turn(|| self.ask(LIQ_API, &ua, params))
    }

    fn names(answer: &Value, list: &str, field: &str) -> Vec<String> {
        answer["query"][list]
            .as_array()
            .map(|a| a.iter().map(|i| crate::js::string(&i[field])).collect())
            .unwrap_or_default()
    }

    fn by_prefix(&self, name: &str, liq: bool) -> Option<Vec<String>> {
        let Some(head) = prefix_of(name) else { return Some(vec![]) };
        let prefix = format!("Cosmetic_icon_{head}");
        let params = [("action", "query"), ("list", "allimages"), ("aiprefix", prefix.as_str()), ("ailimit", "100")];
        let a = if liq { self.ask_liquipedia(&params) } else { self.ask_fandom(&params) }?;
        Some(Self::names(&a, "allimages", "name"))
    }

    fn by_search(&self, name: &str, liq: bool) -> Option<Vec<String>> {
        let search = format!("Cosmetic icon {name}");
        let params = [
            ("action", "query"),
            ("list", "search"),
            ("srnamespace", "6"),
            ("srlimit", "10"),
            ("srsearch", search.as_str()),
        ];
        let a = if liq { self.ask_liquipedia(&params) } else { self.ask_fandom(&params) }?;
        Some(Self::names(&a, "search", "title"))
    }

    fn first_page(answer: &Value) -> Option<&Value> {
        answer["query"]["pages"].as_object().and_then(|p| p.values().next())
    }

    /// The lead picture of the article at this exact title: Some(None) when there is no such page
    /// or it has no picture, None when the wiki did not answer.
    fn page_image(&self, title: &str) -> Option<Option<String>> {
        let a = self.ask_fandom(&[
            ("action", "query"),
            ("titles", title),
            ("prop", "pageimages"),
            ("piprop", "thumbnail"),
            ("pithumbsize", "512"),
            ("redirects", "1"),
        ])?;
        let Some(page) = Self::first_page(&a) else { return Some(None) };
        if page.get("missing").is_some() {
            return Some(None);
        }
        Some(page.get("thumbnail").map(|t| crate::js::string(&t["source"])))
    }

    fn liq_resolve_url(&self, file: &str) -> Option<Option<String>> {
        let title = format!("File:{}", file.replace('_', " "));
        let a =
            self.ask_liquipedia(&[("action", "query"), ("titles", &title), ("prop", "imageinfo"), ("iiprop", "url")])?;
        Some(Self::first_page(&a).and_then(|p| p["imageinfo"].get(0)).map(|i| crate::js::string(&i["url"])))
    }

    /// One pass over both wikis for one exact name: Some(None) is a sure "no".
    fn search_one(&self, name: &str) -> Option<Option<Found>> {
        let mut silent = false;
        for liq in [false, true] {
            for by_search in [false, true] {
                let list = if by_search { self.by_search(name, liq) } else { self.by_prefix(name, liq) };
                let Some(list) = list else {
                    silent = true;
                    continue;
                };
                let Some(file) = pick_title(name, &list) else { continue };
                if !liq {
                    return Some(Some(Found::Fandom(file)));
                }
                match self.liq_resolve_url(&file) {
                    None => silent = true,
                    Some(Some(url)) => return Some(Some(Found::Liquipedia(url))),
                    Some(None) => {}
                }
            }
        }
        if silent {
            None
        } else {
            Some(None)
        }
    }

    /// Which file a wiki keeps this item's picture under; a loading or versus screen that comes up
    /// with nothing gets one more pass under its outfit's own name.
    fn search_file_name(&self, name: &str) -> Option<Option<Found>> {
        match self.search_one(name) {
            Some(None) => match strip_screen_suffix(name) {
                Some(base) => self.search_one(&base),
                None => Some(None),
            },
            other => other,
        }
    }

    fn fetch_bytes(&self, url: &str, ua: &str) -> Got {
        let Ok((status, buf)) = self.net.direct("GET", url, &[("User-Agent", ua)], None, TIMEOUT_MS) else {
            return Got::Silent;
        };
        if status == 404 {
            return Got::No;
        }
        if !(200..300).contains(&status) {
            return Got::Silent;
        }
        match (!buf.is_empty() && buf.len() <= MAX_BYTES).then(|| sniff(&buf)).flatten() {
            Some(mime) => Got::Hit(buf, mime),
            None => Got::Silent,
        }
    }

    fn fandom_file(&self, file: &str) -> Got {
        self.fetch_bytes(&format!("{WIKI}{}", uri_component(file)), UA)
    }

    /// A cosmetic's picture by its name in the game.
    pub fn get(&self, name: &str) -> Option<String> {
        if name.is_empty() {
            return None;
        }
        self.cached(name, || {
            // every step has to have answered for the end to be a "no"
            let mut answered = true;
            for file in cosmetic_file_names(name) {
                match self.fandom_file(&file) {
                    hit @ Got::Hit(..) => return hit,
                    Got::Silent => answered = false,
                    Got::No => {}
                }
            }
            match self.page_image(name) {
                None => answered = false,
                Some(Some(url)) => match self.fetch_bytes(&url, UA) {
                    hit @ Got::Hit(..) => return hit,
                    Got::Silent => answered = false,
                    Got::No => {}
                },
                Some(None) => {}
            }
            match self.search_file_name(name) {
                None => Got::Silent,
                Some(None) if answered => Got::No,
                Some(None) => Got::Silent,
                Some(Some(Found::Fandom(file))) => self.fandom_file(&file),
                Some(Some(Found::Liquipedia(url))) => {
                    let ua = self.liq_ua.clone();
                    self.liq_turn(|| self.fetch_bytes(&url, &ua))
                }
            }
        })
    }

    /// A hero's own portrait, for a mod the app knows skins exactly that hero.
    pub fn get_hero(&self, hero: &str) -> Option<String> {
        if hero.is_empty() {
            return None;
        }
        self.cached(&format!("hero:{hero}"), || {
            let mut answered = true;
            for file in hero_file_names(hero) {
                match self.fandom_file(&file) {
                    hit @ Got::Hit(..) => return hit,
                    Got::Silent => answered = false,
                    Got::No => {}
                }
            }
            if answered {
                Got::No
            } else {
                Got::Silent
            }
        })
    }

    /// The stand-in picture for a kind of content.
    pub fn get_generic(&self, kind: &str) -> Option<String> {
        let title = GENERIC_PAGES.iter().find(|(k, _)| *k == kind)?.1;
        self.cached(&format!("generic:{kind}"), || match self.page_image(title) {
            None => Got::Silent,
            Some(None) => Got::No,
            Some(Some(url)) => self.fetch_bytes(&url, UA),
        })
    }

    /// Pictures for a batch of names, a few requests at a time: "hero:" asks for a hero's portrait,
    /// "generic:" for a stand-in, anything else for a cosmetic. None where there is no picture.
    pub fn get_many(&self, names: &[String]) -> IndexMap<String, Option<String>> {
        let mut list: Vec<String> = Vec::new();
        for n in names {
            if !n.is_empty() && !list.contains(n) {
                list.push(n.clone());
            }
        }
        let next = Mutex::new(0usize);
        let got = Mutex::new(HashMap::<String, Option<String>>::new());
        std::thread::scope(|s| {
            for _ in 0..CONCURRENCY.min(list.len()) {
                s.spawn(|| loop {
                    let i = {
                        let mut n = next.lock().unwrap_or_else(|e| e.into_inner());
                        let i = *n;
                        *n += 1;
                        i
                    };
                    let Some(name) = list.get(i) else { break };
                    let pic = if let Some(h) = name.strip_prefix("hero:") {
                        self.get_hero(h)
                    } else if let Some(k) = name.strip_prefix("generic:") {
                        self.get_generic(k)
                    } else {
                        self.get(name)
                    };
                    got.lock().unwrap_or_else(|e| e.into_inner()).insert(name.clone(), pic);
                });
            }
        });
        let mut got = got.into_inner().unwrap_or_else(|e| e.into_inner());
        list.into_iter()
            .map(|n| {
                let v = got.remove(&n).flatten();
                (n, v)
            })
            .collect()
    }

    pub fn size(&self) -> u64 {
        std::fs::read_dir(&self.dir)
            .map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
            .unwrap_or(0)
    }

    pub fn clear(&self) {
        let _ = std::fs::remove_dir_all(&self.dir);
        let _ = std::fs::create_dir_all(&self.dir);
        self.misses.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_component_is_encode_uri_component() {
        assert_eq!(uri_component("Cosmetic_icon_Ash (x)'s.png"), "Cosmetic_icon_Ash%20(x)'s.png");
        assert_eq!(uri_component("ä"), "%C3%A4");
    }

    #[test]
    fn a_miss_is_remembered_and_silence_is_not() {
        let dir = std::env::temp_dir().join(format!("wiki-icons-{}", uuid::Uuid::new_v4()));
        let w = WikiIcons::new(&dir, Arc::new(Net::new(|| 1.7e12)), || 1.7e12, "1.0.0");
        assert_eq!(w.cached("a", || Got::Silent), None);
        assert!(w.misses.lock().unwrap().is_empty());
        assert_eq!(w.cached("a", || Got::No), None);
        assert_eq!(
            w.cached("a", || Got::Hit(vec![0x89, 0x50, 0x4e, 0x47], "image/png")),
            None,
            "a fresh miss is not asked again"
        );
        let png = vec![0x89, 0x50, 0x4e, 0x47, 1];
        assert!(w.cached("b", || Got::Hit(png.clone(), "image/png")).unwrap().starts_with("data:image/png;base64,"));
        assert!(w.cached("b", || Got::No).is_some(), "the cached file answers");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
