//! What the user's Discord profile says while the app is open (src/presence-status.ts): which
//! screen they are on, and how many mods are switched on, in the language the user chose for the
//! app. The connection itself is the shell's (src-tauri, Discord's local socket); this decides
//! what it says.

use serde_json::{json, Value};

use crate::i18n::t;

/// The first line of the status for each screen the window reports.
const PRESENCE_VIEWS: [(&str, &str); 7] = [
    ("catalog", "Смотрит каталог модов"),
    ("library", "В своей библиотеке"),
    ("presets", "Собирает пресет"),
    ("cosmetics", "Выбирает косметику"),
    ("tools", "В инструментах"),
    ("guides", "Читает гайды"),
    ("settings", "В настройках"),
];

/// Where the buttons on the status lead.
pub const SITE: &str = "https://dota2modmanager.com/";

/// The status for one moment: the screen, the switched-on mods, and whether the master switch is off.
pub fn presence_activity(view: &str, mods: f64, master_off: bool) -> Value {
    let state = if master_off {
        t("Моды выключены", &[])
    } else if mods != 0.0 && !mods.is_nan() {
        t("{0} модов включено", &[crate::js::json_number(mods)])
    } else {
        t("Ещё без модов", &[])
    };
    let line = PRESENCE_VIEWS.iter().find(|(v, _)| *v == view).unwrap_or(&PRESENCE_VIEWS[0]).1;
    json!({
        "details": t(line, &[]),
        "state": state,
        "buttons": [{ "label": t("Скачать Mod Manager", &[]), "url": SITE }],
    })
}

/// The activity as Discord's SET_ACTIVITY takes it: "Playing", the two lines when they say
/// something, since when, and up to two buttons unless Discord turned buttons down once.
pub fn discord_activity(a: &Value, started_at: f64, drop_buttons: bool) -> Value {
    let mut out = serde_json::Map::new();
    out.insert("type".into(), json!(0));
    for k in ["details", "state"] {
        if let Some(v) = a.get(k).filter(|v| crate::js::truthy(v)) {
            out.insert(k.into(), v.clone());
        }
    }
    out.insert("timestamps".into(), json!({ "start": crate::js::json_number(started_at) }));
    if let Some(b) = a.get("buttons").and_then(Value::as_array).filter(|b| !b.is_empty() && !drop_buttons) {
        out.insert("buttons".into(), Value::Array(b.iter().take(2).cloned().collect()));
    }
    Value::Object(out)
}

/// One frame of Discord's local protocol: the opcode and the JSON's length, little-endian, then the JSON.
pub fn encode_frame(op: i32, data: &Value) -> Vec<u8> {
    let json = crate::js::stringify(data, "");
    let mut out = Vec::with_capacity(8 + json.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(json.len() as i32).to_le_bytes());
    out.extend_from_slice(json.as_bytes());
    out
}

/// The whole frames at the front of `buf`, taken off it: each opcode and its JSON (None when the
/// body is not JSON). A frame not all there yet stays for the next read.
pub fn take_frames(buf: &mut Vec<u8>) -> Vec<(i32, Option<Value>)> {
    let mut out = Vec::new();
    loop {
        if buf.len() < 8 {
            return out;
        }
        let op = i32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
        let len = i32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
        if len < 0 || buf.len() < 8 + len as usize {
            return out;
        }
        let body = String::from_utf8_lossy(&buf[8..8 + len as usize]).into_owned();
        buf.drain(..8 + len as usize);
        out.push((op, serde_json::from_str(&body).ok()));
    }
}
