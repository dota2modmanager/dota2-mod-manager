//! What a mod actually replaces, asked of the game instead of guessed from folder names
//! (src/mod-id.ts). The item table says where each cosmetic's model lives (`model_player`) and
//! who wears it (`used_by_heroes`), so a mod that overrides that path replaces that item, by
//! name. Without a game path there is no answer and the caller keeps the guess.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use regex::bytes::Regex;
use serde::Serialize;

/// One item a model path leads to.
#[derive(Clone, Debug)]
struct ItemRef {
    name: String,
    slot: String,
    heroes: Vec<String>,
}

/// What a mod's paths say it is.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModIdentityGuess {
    pub items: Vec<String>,
    pub slots: Vec<String>,
    pub hero_names: Vec<String>,
}

#[derive(Default)]
struct State {
    index: Option<HashMap<String, Vec<ItemRef>>>,
    stamp: Option<String>,
    last_unreadable: Option<String>,
}

/// The index of the game's item table by model path, built once per build of the game.
pub struct ModIdentity {
    pub game: Option<PathBuf>,
    state: Mutex<State>,
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

fn model_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // JavaScript's \s over a latin1 string: ASCII space and the no-break space
    R.get_or_init(|| Regex::new(r#"(?i-u)"model_player"[\t\n\x0B\x0C\r \xA0]+"([^"]+)""#).unwrap())
}

fn hero_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?i-u)"(npc_dota_hero_[a-z0-9_]+)"[\t\n\x0B\x0C\r \xA0]+"1""#).unwrap())
}

impl ModIdentity {
    pub fn new(game: Option<PathBuf>) -> Self {
        ModIdentity { game, state: Mutex::new(State::default()) }
    }

    /// Whether there is a game to ask.
    pub fn ready(&self) -> bool {
        self.game.is_some()
    }

    /// Forget the index (the game changed).
    pub fn clear(&self) {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        s.index = None;
        s.stamp = None;
    }

    fn build(&self, s: &mut State, log: &mut dyn FnMut(String)) -> bool {
        let Some(game) = self.game.as_ref() else { return false };
        let stamp = crate::pak_stamp::game_schema_stamp(game).ok();
        if s.index.is_some() && stamp.is_some() && stamp == s.stamp {
            return true;
        }
        let text = match crate::schema::read_game_schema(game) {
            Ok((text, _)) => text,
            Err(why) => {
                // once per reason, not once per mod
                if s.last_unreadable.as_deref() != Some(why.as_str()) {
                    log(format!("mod id: item table unreadable ({why})"));
                    s.last_unreadable = Some(why);
                }
                return false;
            }
        };
        let Ok(items) = crate::schema::list_items(&text) else { return false };
        let mut map: HashMap<String, Vec<ItemRef>> = HashMap::new();
        for item in items {
            let block = &text[item.start..item.end];
            let Some(model) = model_re().captures(block) else { continue };
            if item.name.is_empty() {
                continue;
            }
            let key = latin1(&model[1]).to_lowercase().replace('\\', "/");
            let key = key.trim_start_matches('/').to_string();
            let heroes = hero_re()
                .captures_iter(block)
                .map(|m| latin1(&m[1])["npc_dota_hero_".len()..].to_lowercase())
                .collect();
            let entry = ItemRef { name: crate::schema::to_utf8(&item.name), slot: item.slot.clone(), heroes };
            map.entry(key).or_default().push(entry);
        }
        log(format!("mod id: {} model paths lead to a named item", map.len()));
        s.index = Some(map);
        s.stamp = stamp;
        true
    }

    /// The items a mod's compiled models replace, or None when the table says nothing about them.
    pub fn identify<'a>(
        &self,
        paths: impl IntoIterator<Item = &'a str>,
        log: &mut dyn FnMut(String),
    ) -> Option<ModIdentityGuess> {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !self.build(&mut s, log) {
            return None;
        }
        let map = s.index.as_ref()?;
        let mut items: Vec<String> = Vec::new();
        let mut slots: Vec<String> = Vec::new();
        let mut heroes: Vec<String> = Vec::new();
        let add = |v: &mut Vec<String>, x: &str| {
            if !v.iter().any(|y| y == x) {
                v.push(x.to_string());
            }
        };
        for p in paths {
            let Some(src) = p.strip_suffix("_c").filter(|_| p.ends_with(".vmdl_c")) else { continue };
            for it in map.get(src).into_iter().flatten() {
                add(&mut items, &it.name);
                if !it.slot.is_empty() {
                    add(&mut slots, &it.slot);
                }
                for h in &it.heroes {
                    add(&mut heroes, h);
                }
            }
        }
        if items.is_empty() {
            return None;
        }
        items.sort_by(|a, b| crate::js::locale_compare(a, b));
        Some(ModIdentityGuess {
            items,
            slots,
            hero_names: heroes.iter().map(|h| crate::hero_names::display_name(h)).collect(),
        })
    }
}
