//! What each channel may be handed, checked before its handler runs (src/channel-args.ts). The
//! values that arrive over IPC are whatever the page sent, and the handlers behind these channels
//! write the game folder, open folders, launch programs and change the settings. So a call whose
//! arguments do not fit is refused before the handler sees it: a string where a string goes, an
//! id that is an id, a list that is not a million items long. The window may set only the
//! settings it has a control for.
//!
//! An argument is `None` when the page did not send it (JavaScript's undefined) and bytes arrive
//! as `{"$b64": "..."}`, as the bridge sends them. Every refusal reads as the TypeScript's.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde_json::Value;

/// Why a value does not fit, or None when it does.
pub type Check = Box<dyn Fn(Option<&Value>) -> Option<String> + Send + Sync>;

/// The arcanas the arcana window builds (arcana_service.rs WINDOWS).
pub const ARCANA_WINDOWS: [&str; 5] =
    ["terrorblade-arcana", "techies-arcana", "terrorblade-span", "terrorblade-scythes", "razor-crest"];

const MB: f64 = 1024.0 * 1024.0;

fn fail(what: &str) -> Option<String> {
    Some(format!("expected {what}"))
}

fn n(x: f64) -> String {
    crate::js::number(x)
}

fn len16(s: &str) -> usize {
    s.encode_utf16().count()
}

/// JavaScript's String(v), with None as "undefined".
fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        // bytes are a Uint8Array to the page: its numbers, comma-separated
        Some(Value::Object(o)) if byte_len(Some(&Value::Object(o.clone()))).is_some() => {
            crate::js::base64_decode(o["$b64"].as_str().unwrap_or(""))
                .iter()
                .map(u8::to_string)
                .collect::<Vec<_>>()
                .join(",")
        }
        Some(Value::Object(_)) => "[object Object]".into(),
        Some(Value::Array(a)) => {
            a.iter().map(|x| if x.is_null() { String::new() } else { js_string(Some(x)) }).collect::<Vec<_>>().join(",")
        }
        Some(v) => crate::js::string(v),
    }
}

fn str_(max: usize, min: usize) -> Check {
    Box::new(move |v| match v.and_then(Value::as_str) {
        Some(s) if (min..=max).contains(&len16(s)) => None,
        _ => fail(&format!("a string of {min}-{max} characters")),
    })
}

fn bool_() -> Check {
    Box::new(|v| if matches!(v, Some(Value::Bool(_))) { None } else { fail("true or false") })
}

fn num(min: f64, max: f64) -> Check {
    Box::new(move |v| match v.and_then(Value::as_f64) {
        Some(x) if x.is_finite() && x >= min && x <= max => None,
        _ => fail(&format!("a number from {} to {}", n(min), n(max))),
    })
}

/// One of these values; `None` in the list stands for null.
fn one_of(allowed: &'static [Option<&'static str>]) -> Check {
    Box::new(move |v| {
        let ok = allowed.iter().any(|a| match (a, v) {
            (None, Some(Value::Null)) => true,
            (Some(a), Some(Value::String(s))) => a == s,
            _ => false,
        });
        if ok {
            return None;
        }
        fail(&format!("one of {}", allowed.iter().map(|a| a.unwrap_or("")).collect::<Vec<_>>().join(", ")))
    })
}

fn optional(c: Check) -> Check {
    Box::new(move |v| match v {
        None | Some(Value::Null) => None,
        _ => c(v),
    })
}

fn either(cs: Vec<Check>) -> Check {
    Box::new(move |v| {
        if cs.iter().any(|c| c(v).is_none()) {
            return None;
        }
        Some(cs.iter().map(|c| c(v).unwrap_or_default()).collect::<Vec<_>>().join(" or "))
    })
}

fn list(of: Check, max: usize) -> Check {
    Box::new(move |v| {
        let Some(a) = v.and_then(Value::as_array) else { return fail("a list") };
        if a.len() > max {
            return fail(&format!("at most {max} items"));
        }
        a.iter().enumerate().find_map(|(i, x)| of(Some(x)).map(|bad| format!("item {i}: {bad}")))
    })
}

/// A plain object with these keys and no others; a key whose check allows undefined may be missing.
fn shape(fields: Vec<(&'static str, Check)>) -> Check {
    Box::new(move |v| {
        let Some(o) = obj_view(v) else { return fail("an object") };
        if let Some(k) = o.keys().find(|k| !fields.iter().any(|(f, _)| f == k)) {
            return Some(format!("unexpected key {k}"));
        }
        fields.iter().find_map(|(k, c)| c(o.get(*k)).map(|bad| format!("{k}: {bad}")))
    })
}

/// The size of `{"$b64": ...}` once decoded, or None when it is not bytes.
fn byte_len(v: Option<&Value>) -> Option<usize> {
    let s = v?.as_object().filter(|o| o.len() == 1)?.get("$b64")?.as_str()?;
    let pad = s.bytes().rev().take_while(|b| *b == b'=').count();
    Some(
        (s.len() / 4) * 3
            + match s.len() % 4 {
                2 => 1,
                3 => 2,
                _ => 0,
            }
            - if s.len() % 4 == 0 { pad } else { 0 },
    )
}

/// A value as the object JavaScript sees: bytes are a Uint8Array, whose keys are its indexes.
fn obj_view(v: Option<&Value>) -> Option<std::borrow::Cow<'_, serde_json::Map<String, Value>>> {
    let o = v?.as_object()?;
    if byte_len(v).is_none() {
        return Some(std::borrow::Cow::Borrowed(o));
    }
    let bytes = crate::js::base64_decode(o["$b64"].as_str().unwrap_or(""));
    Some(std::borrow::Cow::Owned(bytes.iter().enumerate().map(|(i, b)| (i.to_string(), Value::from(*b))).collect()))
}

fn bytes(max: f64) -> Check {
    Box::new(move |v| match byte_len(v) {
        Some(n) if (n as f64) <= max => None,
        _ => fail(&format!("bytes, at most {}", n(max))),
    })
}

/// JSON.stringify as the page's value would come out: bytes as a Uint8Array's object.
fn json_text(v: &Value) -> String {
    match v {
        Value::Object(_) if byte_len(Some(v)).is_some() => {
            crate::js::stringify(&Value::Object(obj_view(Some(v)).unwrap().into_owned()), "")
        }
        Value::Object(o) => {
            let inner: serde_json::Map<String, Value> = o
                .iter()
                .map(|(k, x)| (k.clone(), serde_json::from_str(&json_text(x)).unwrap_or(Value::Null)))
                .collect();
            crate::js::stringify(&Value::Object(inner), "")
        }
        Value::Array(a) => crate::js::stringify(
            &Value::Array(a.iter().map(|x| serde_json::from_str(&json_text(x)).unwrap_or(Value::Null)).collect()),
            "",
        ),
        _ => crate::js::stringify(v, ""),
    }
}

/// Anything JSON can say, up to a size.
fn json(max: usize) -> Check {
    Box::new(move |v| match v {
        Some(v) if len16(&json_text(v)) <= max => None,
        _ => fail(&format!("JSON of at most {max} characters")),
    })
}

fn custom(f: fn(Option<&Value>) -> Option<String>) -> Check {
    Box::new(f)
}

#[allow(non_snake_case)]
fn ID() -> Check {
    str_(200, 1)
}
#[allow(non_snake_case)]
fn IDS() -> Check {
    list(ID(), 10000)
}
#[allow(non_snake_case)]
fn PATH() -> Check {
    str_(4096, 1)
}
#[allow(non_snake_case)]
fn NAME() -> Check {
    str_(500, 0)
}
#[allow(non_snake_case)]
fn PREVIEW() -> Check {
    optional(str_(16 * 1024 * 1024, 0))
}
fn hud_part() -> Check {
    shape(vec![
        ("id", str_(40, 1)),
        ("scale", optional(num(60.0, 130.0))),
        ("x", optional(num(-1920.0, 1920.0))),
        ("y", optional(num(-1920.0, 1920.0))),
        ("opacity", optional(num(10.0, 100.0))),
        ("tint", optional(str_(7, 7))),
        ("hidden", optional(bool_())),
    ])
}
fn effect_edits() -> Check {
    Box::new(|v| {
        let Some(o) = obj_view(v) else { return fail("an object") };
        if o.len() <= 64 {
            json(16000)(v)
        } else {
            fail("at most 64 systems")
        }
    })
}
fn look_pick() -> Check {
    shape(vec![
        ("slot", str_(200, 1)),
        ("itemId", str_(20, 1)),
        ("name", str_(500, 0)),
        ("effectId", optional(str_(500, 0))),
    ])
}
fn str_or_num(s: usize, smin: usize) -> Check {
    either(vec![str_(s, smin), num(0.0, 1e9)])
}

fn download_proxy(v: Option<&Value>) -> Option<String> {
    crate::net_fetch::validate_download_proxy(v.unwrap_or(&Value::Null)).err()
}

fn mod_labels(v: Option<&Value>) -> Option<String> {
    let Some(o) = obj_view(v) else { return fail("an object") };
    if o.len() > 5000 {
        return fail("at most 5000 labels");
    }
    for (k, label) in o.iter() {
        let rest = k.strip_prefix("rec:").or_else(|| k.strip_prefix("file:"));
        let fits = rest.is_some_and(|r| {
            let l = len16(r);
            (1..=500).contains(&l) && !r.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
        });
        let shown = crate::js::slice_utf16(k, 60);
        if !fits {
            return Some(format!("label key {shown}: expected rec:<id> or file:<name>"));
        }
        if let Some(bad) = str_(80, 1)(Some(label)) {
            return Some(format!("label {shown}: {bad}"));
        }
    }
    None
}

fn ui_lang(v: Option<&Value>) -> Option<String> {
    let ok = v.and_then(Value::as_str).is_some_and(|s| {
        let b = s.as_bytes();
        let two = |x: &[u8], f: fn(&u8) -> bool| x.len() == 2 && x.iter().all(f);
        match b.len() {
            2 => two(b, u8::is_ascii_lowercase),
            5 => two(&b[..2], u8::is_ascii_lowercase) && b[2] == b'-' && two(&b[3..], u8::is_ascii_alphabetic),
            _ => false,
        }
    });
    if ok {
        None
    } else {
        fail("a language code")
    }
}

fn open_external(v: Option<&Value>) -> Option<String> {
    let Some(s) = v.and_then(Value::as_str).filter(|s| len16(s) <= 4096) else { return fail("an address") };
    match url::Url::parse(s) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => None,
        Ok(_) => fail("an http or https address"),
        Err(_) => fail("an address"),
    }
}

/// The settings the window has a control for, and what each may be set to.
pub fn window_settings() -> &'static HashMap<&'static str, Check> {
    static T: OnceLock<HashMap<&'static str, Check>> = OnceLock::new();
    T.get_or_init(|| {
        let item_look = shape(vec![
            ("id", str_(60, 1)),
            ("hero", str_(200, 1)),
            ("name", str_(80, 1)),
            ("picks", list(look_pick(), 40)),
            ("at", num(0.0, 1e14)),
        ]);
        HashMap::from([
            ("discordPresence", bool_()),
            ("countDownloads", bool_()),
            ("everyoneWearsMine", bool_()),
            ("favorites", list(str_(500, 0), 20000)),
            ("itemLooks", list(item_look, 2000)),
            ("langPromptSeen", bool_()),
            ("langFolderLock", one_of(&[None, Some("koreana"), Some("russian"), Some("schinese")])),
            ("modLabels", custom(mod_labels)),
            ("panels", either(vec![one_of(&[None]), json(64 * 1024)])),
            ("pumpkin", bool_()),
            ("pumpkinLit", bool_()),
            ("runInBackground", bool_()),
            ("secret", bool_()),
            ("showAdult", bool_()),
            ("theme", str_(40, 1)),
            ("toolsPromptSeen", bool_()),
            ("downloadProxy", custom(download_proxy)),
            ("uiLang", custom(ui_lang)),
        ])
    })
}

fn settings_key(v: Option<&Value>) -> Option<String> {
    match v.and_then(Value::as_str) {
        Some(k) if window_settings().contains_key(k) => None,
        _ => Some(format!("the window may not set {}", crate::js::slice_utf16(&js_string(v), 60))),
    }
}

/// Each channel's arguments, in order.
pub fn channel_args() -> &'static HashMap<&'static str, Vec<Check>> {
    static T: OnceLock<HashMap<&'static str, Vec<Check>>> = OnceLock::new();
    T.get_or_init(|| {
        let mut m: HashMap<&'static str, Vec<Check>> = HashMap::new();
        let none: &[&str] = &[
            "win:minimize",
            "win:maximize",
            "win:close",
            "win:isMaximized",
            "app:version",
            "app:notesSeen",
            "app:stars",
            "update:install",
            "update:fetchPortable",
            "beta:state",
            "game:launch",
            "game:steamDownloads",
            "game:steamProperties",
            "grid:state",
            "grid:remove",
            "settings:get",
            "settings:detectDota",
            "settings:browseDota",
            "support:state",
            "account:signIn",
            "account:signOut",
            "catalog:terrainAges",
            "catalog:downloadCounts",
            "mods:list",
            "mods:switchOffStaleTerrains",
            "mods:importDialog",
            "mods:importFolderDialog",
            "mods:masterState",
            "mods:removeEverything",
            "mods:mapsOwner",
            "presets:list",
            "presets:importDialog",
            "presets:ready",
            "config:state",
            "patch:state",
            "patch:repairState",
            "patch:repairNow",
            "patch:repairApp",
            "patch:repairSeen",
            "schema:refresh",
            "schema:cancel",
            "cosmetics:slots",
            "tools:state",
            "compiler:state",
            "compiler:browse",
            "compiler:forget",
            "compiler:prepare",
            "compiler:check",
            "compiler:keep",
            "compiler:removeKept",
            "sounds:heroes",
            "hud:state",
            "fx:heroes",
            "creator:list",
            "rank:state",
            "rank:pictures",
            "decor:state",
            "background:state",
            "icons:heroes",
            "map:state",
            "arcana:state",
            "misc:openLangFolder",
            "misc:openCacheFolder",
            "misc:cacheSize",
            "misc:clearCache",
            "misc:cacheList",
            "pumpkin:prizeAgain",
            "pumpkin:hasPrize",
            "diag:export",
            "uninstall:plan",
            "uninstall:cancel",
        ];
        for c in none {
            m.insert(c, vec![]);
        }
        let slot_stock = || shape(vec![("slot", str_(120, 1)), ("stock", str_(20, 1))]);
        let entries: Vec<(&'static str, Vec<Check>)> = vec![
            ("app:notes", vec![str_(16, 0)]),
            ("update:revealPortable", vec![PATH()]),
            ("beta:set", vec![bool_()]),
            ("grid:apply", vec![list(one_of(&[Some("winrate"), Some("attribute"), Some("popular")]), 3)]),
            ("ui:setZoom", vec![num(0.25, 5.0)]),
            ("settings:set", vec![custom(settings_key), Box::new(|_| None)]),
            ("settings:testProxy", vec![custom(download_proxy)]),
            ("settings:moveLangFiles", vec![optional(str_(64, 0))]),
            ("presence:view", vec![str_(64, 0)]),
            ("support:choose", vec![one_of(&[Some("later"), Some("done")])]),
            ("catalog:load", vec![optional(bool_())]),
            (
                "mods:install",
                vec![shape(vec![
                    ("categoryId", str_(100, 0)),
                    ("name", NAME()),
                    ("styleLabel", optional(NAME())),
                    ("fileRef", optional(str_(1000, 0))),
                    ("preview", PREVIEW()),
                ])],
            ),
            ("mods:update", vec![ID()]),
            ("mods:clearPrePatch", vec![ID()]),
            ("mods:importPaths", vec![list(PATH(), 10000)]),
            (
                "mods:importBuffers",
                vec![list(shape(vec![("name", str_(1000, 1)), ("data", bytes(4096.0 * MB))]), 1000)],
            ),
            ("mods:exportSingle", vec![ID()]),
            ("mods:unpackToFolder", vec![ID()]),
            ("mods:setMaster", vec![bool_()]),
            ("mods:setEnabled", vec![ID(), bool_()]),
            ("mods:setEnabledMany", vec![IDS(), bool_()]),
            ("mods:remove", vec![ID()]),
            ("mods:removeMany", vec![IDS()]),
            ("mods:move", vec![ID(), num(-1.0, 1.0)]),
            ("mods:reorder", vec![ID(), num(0.0, 10000.0)]),
            ("mods:externalSetEnabled", vec![PATH(), bool_()]),
            ("mods:externalRemove", vec![PATH()]),
            ("mods:splitMod", vec![ID()]),
            ("mods:dropItemIcons", vec![ID()]),
            ("mods:splitExternal", vec![PATH()]),
            ("mods:adoptMod", vec![ID(), PREVIEW()]),
            ("mods:adoptExternal", vec![PATH(), PREVIEW()]),
            ("mods:adoptFont", vec![NAME(), PREVIEW()]),
            ("mods:adoptCursor", vec![PREVIEW()]),
            ("packs:combine", vec![shape(vec![("name", NAME()), ("modIds", IDS())])]),
            ("packs:addMembers", vec![ID(), IDS()]),
            ("packs:setMemberEnabled", vec![ID(), ID(), bool_()]),
            ("packs:removeMember", vec![ID(), ID()]),
            ("packs:extractMembers", vec![ID(), IDS()]),
            ("packs:disband", vec![ID()]),
            ("presets:save", vec![NAME()]),
            ("presets:update", vec![ID()]),
            ("presets:rename", vec![ID(), NAME()]),
            ("presets:delete", vec![ID()]),
            ("presets:apply", vec![ID()]),
            ("presets:resolve", vec![ID()]),
            ("presets:exportPlan", vec![ID()]),
            ("presets:shareLink", vec![ID()]),
            (
                "presets:export",
                vec![
                    ID(),
                    optional(shape(vec![
                        ("skip", optional(list(str_(1000, 0), 10000))),
                        ("author", optional(str_(200, 0))),
                        ("note", optional(str_(5000, 0))),
                    ])),
                ],
            ),
            ("presets:importFile", vec![PATH()]),
            ("presets:takeReady", vec![ID()]),
            ("config:noticeSeen", vec![str_(200, 1)]),
            ("patch:setEnabled", vec![bool_()]),
            ("cosmetics:heroPortraits", vec![list(str_or_num(100, 0), 1000), optional(bool_())]),
            ("cosmetics:heroPortraitsByName", vec![list(str_(200, 0), 1000)]),
            ("cosmetics:icons", vec![list(str_(500, 0), 20000)]),
            ("cosmetics:pick", vec![str_(100, 1), str_or_num(100, 0), optional(NAME()), optional(str_or_num(100, 0))]),
            ("cosmetics:pickSet", vec![str_or_num(100, 1), optional(num(0.0, 64.0))]),
            ("cosmetics:wearLook", vec![str_(200, 1), list(look_pick(), 40)]),
            ("preview:video", vec![str_(500, 1)]),
            ("preview:frame", vec![str_(500, 1), bytes(32.0 * MB)]),
            ("tools:install", vec![str_(100, 1)]),
            ("tools:remove", vec![str_(100, 1)]),
            ("preview3d:warm", vec![str_(80, 1), list(slot_stock(), 40)]),
            ("preview3d:prefetch", vec![str_(80, 1), list(slot_stock(), 40), str_(120, 1), list(str_(20, 1), 400)]),
            (
                "preview3d:models",
                vec![
                    str_(80, 1),
                    list(
                        shape(vec![
                            ("slot", str_(120, 1)),
                            ("stock", str_(20, 1)),
                            ("tryOn", optional(shape(vec![("itemId", str_(20, 0)), ("effectId", str_(500, 0))]))),
                        ]),
                        40,
                    ),
                ],
            ),
            ("preview3d:slice", vec![num(1.0, 9007199254740991.0), num(0.0, 9007199254740991.0)]),
            ("preview3d:motions", vec![str_(200, 1)]),
            ("preview3d:effect", vec![str_(40, 1)]),
            ("preview3d:model", vec![str_(200, 1)]),
            ("sounds:hero", vec![str_(60, 1)]),
            ("sounds:remove", vec![str_(60, 1), str_(200, 1)]),
            (
                "sounds:add",
                vec![
                    str_(60, 1),
                    str_(200, 1),
                    one_of(&[Some("replace"), Some("layer")]),
                    num(0.05, 1.0),
                    bytes(8.0 * MB),
                    str_(200, 0),
                ],
            ),
            ("hud:install", vec![list(hud_part(), 11)]),
            ("fx:search", vec![str_(200, 0)]),
            ("fx:hero", vec![str_(40, 2)]),
            ("fx:load", vec![str_(300, 1)]),
            ("fx:preview", vec![str_(300, 1), effect_edits()]),
            ("fx:install", vec![str_(300, 1), effect_edits(), optional(bool_())]),
            ("creator:remove", vec![ID()]),
            ("creator:export", vec![ID(), optional(list(optional(bytes(8.0 * MB)), 3))]),
            (
                "creator:save",
                vec![
                    optional(ID()),
                    shape(vec![
                        ("name", optional(str_(500, 0))),
                        ("category", optional(str_(60, 0))),
                        ("hero", optional(str_(60, 0))),
                        ("description", optional(str_(5000, 0))),
                        ("author", optional(str_(200, 0))),
                        ("replaces", optional(shape(vec![("category", str_(60, 1)), ("name", str_(500, 1))]))),
                        ("styles", optional(list(shape(vec![("label", str_(200, 0))]), 12))),
                    ]),
                ],
            ),
            ("creator:attach", vec![ID(), num(0.0, 11.0), one_of(&[Some("vpk"), Some("picture")])]),
            ("rank:install", vec![json(64 * 1024)]),
            ("decor:install", vec![list(one_of(&[Some("plants"), Some("debris")]), 2)]),
            (
                "background:install",
                vec![optional(bytes(48.0 * MB)), optional(str_(200, 0)), num(0.0, 0.9), num(0.0, 20.0)],
            ),
            ("icons:hero", vec![str_(40, 2)]),
            ("icons:pictures", vec![list(str_(160, 1), 200)]),
            ("icons:set", vec![str_(40, 2), str_(100, 1), optional(str_(160, 1))]),
            ("icons:clear", vec![str_(40, 2)]),
            ("paint:state", vec![str_(40, 2), optional(list(str_(12, 0), 24))]),
            ("paint:icons", vec![list(str_(100, 0), 60)]),
            (
                "paint:install",
                vec![str_(40, 2), json(64 * 1024), optional(str_(80, 0)), optional(list(str_(12, 0), 24))],
            ),
            (
                "map:install",
                vec![one_of(&[Some("towers"), Some("trees")]), optional(str_(40, 0)), optional(str_(40, 0))],
            ),
            (
                "arcana:install",
                vec![
                    one_of(&[
                        Some(ARCANA_WINDOWS[0]),
                        Some(ARCANA_WINDOWS[1]),
                        Some(ARCANA_WINDOWS[2]),
                        Some(ARCANA_WINDOWS[3]),
                        Some(ARCANA_WINDOWS[4]),
                    ]),
                    list(num(0.0, 255.0), 3),
                    one_of(&[Some("mod"), Some("recolor")]),
                ],
            ),
            ("misc:openToolsFolder", vec![optional(str_(260, 1))]),
            ("misc:openExternal", vec![optional(custom(open_external))]),
            ("misc:cacheRemove", vec![str_(520, 1)]),
            ("misc:runTool", vec![str_(260, 1)]),
            ("pumpkin:redeem", vec![str_(80, 0)]),
            ("diag:rendererError", vec![str_(4 * 1024 * 1024, 0)]),
            (
                "uninstall:run",
                vec![optional(shape(vec![
                    ("revert", optional(bool_())),
                    ("mods", optional(bool_())),
                    ("data", optional(bool_())),
                ]))],
            ),
            ("uninstall:done", vec![bool_()]),
        ];
        for (c, checks) in entries {
            m.insert(c, checks);
        }
        m
    })
}

/// Check one call. Fewer arguments than the channel takes is fine when the missing ones are
/// optional; more is not.
pub fn check_args(channel: &str, args: &[Value]) -> Option<String> {
    let Some(checks) = channel_args().get(channel) else { return Some(format!("no argument check for {channel}")) };
    if args.len() > checks.len() {
        return Some(format!("{channel} takes {} argument(s), got {}", checks.len(), args.len()));
    }
    for (i, c) in checks.iter().enumerate() {
        if let Some(bad) = c(args.get(i)) {
            return Some(format!("{channel} argument {}: {bad}", i + 1));
        }
    }
    if channel == "settings:set" {
        let key = args[0].as_str().unwrap_or("");
        if let Some(bad) = window_settings()[key](args.get(1)) {
            return Some(format!("settings:set {}: {bad}", js_string(args.first())));
        }
    }
    None
}
