//! settings.json in userData: the defaults, what the file adds over them, and the file written back
//! as the TypeScript writes it. Replacing src/settings.ts, whose comments say what each setting is
//! for and why it starts where it does.

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use crate::atomic_file::write_file_atomic;
use crate::js;

/// Every setting and where it starts, in the order the file lists them.
pub fn defaults() -> Map<String, Value> {
    let v = json!({
        "dotaGamePath": null,
        "langSuffix": "russian",
        "langFolderLock": null,
        "uiLang": "en",
        "langPromptSeen": false,
        "uiScale": 1,
        "theme": "ursa",
        "pumpkin": false,
        "secret": false,
        "pumpkinLit": false,
        "favorites": [],
        "modLabels": {},
        "panels": null,
        "account": null,
        "discordPresence": true,
        "runInBackground": true,
        "countDownloads": true,
        "schemaPatch": false,
        "cosmetics": {},
        "itemLooks": [],
        "schemaStamp": null,
        "lastPreset": null,
        "everyoneWearsMine": false,
        "schemaPending": false,
        "toolsPromptSeen": false,
        "showAdult": null,
        "lastSeenVersion": null,
        "downloadProxy": "",
        "resourceCompilerPath": null,
    });
    match v {
        Value::Object(o) => o,
        _ => Map::new(),
    }
}

/// `{...DEFAULTS, ...parsed}`: a key the file has keeps its place among the defaults, a key it adds
/// goes after them. A file that is not an object spreads as JavaScript spreads one.
fn spread(onto: &mut Map<String, Value>, parsed: Value) {
    match parsed {
        Value::Object(o) => {
            for (k, v) in o {
                onto.insert(k, v);
            }
        }
        Value::Array(a) => {
            for (i, v) in a.into_iter().enumerate() {
                onto.insert(i.to_string(), v);
            }
        }
        Value::String(s) => {
            // a string spreads by UTF-16 unit; a whole char stands in for a pair
            for (i, c) in s.encode_utf16().enumerate() {
                let unit = String::from_utf16_lossy(&[c]);
                onto.insert(i.to_string(), Value::String(unit));
            }
        }
        _ => {}
    }
}

/// The settings store.
pub struct Settings {
    pub file: PathBuf,
    pub data: Map<String, Value>,
}

impl Settings {
    pub fn new(user_data_dir: &Path) -> Settings {
        let mut s = Settings { file: user_data_dir.join("settings.json"), data: defaults() };
        s.load();
        s
    }

    /// Read the file over the defaults; a file that does not parse leaves the defaults alone.
    pub fn load(&mut self) {
        let Ok(bytes) = std::fs::read(&self.file) else { return };
        // a byte order mark in front is what Notepad and Windows PowerShell 5 write
        let text = String::from_utf8_lossy(&bytes);
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        let mut data = defaults();
        match serde_json::from_str::<Value>(text) {
            Ok(parsed) => {
                spread(&mut data, parsed);
                self.data = data;
            }
            Err(_) => self.data = defaults(),
        }
    }

    /// The file as JSON.stringify(data, null, 2) writes it.
    pub fn text(&self) -> String {
        js::stringify(&Value::Object(self.data.clone()), "  ")
    }

    pub fn save(&self) -> std::io::Result<()> {
        write_file_atomic(&self.file, self.text().as_bytes())
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data.get(key)
    }

    pub fn set(&mut self, key: &str, value: Value) -> std::io::Result<()> {
        self.data.insert(key.to_string(), value);
        self.save()
    }

    /// Every setting, a copy.
    pub fn all(&self) -> Map<String, Value> {
        self.data.clone()
    }
}
