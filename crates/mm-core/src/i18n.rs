//! The main process's strings, replacing src/i18n.ts: Russian is the source, English and Chinese
//! are keyed by the exact Russian text, with {0}, {1}... for values. A missing key falls back to
//! the Russian, so nothing shows empty.

use serde_json::Value;
use std::sync::atomic::{AtomicU8, Ordering};

use crate::data;
use crate::js;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    Ru,
    ZhCn,
}

impl Lang {
    /// "ru" and "zh-CN" as they are, anything else English.
    pub fn parse(s: &str) -> Lang {
        match s {
            "ru" => Lang::Ru,
            "zh-CN" => Lang::ZhCn,
            _ => Lang::En,
        }
    }
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Ru => "ru",
            Lang::ZhCn => "zh-CN",
        }
    }
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn set_lang(lang: Lang) {
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

pub fn lang() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::Ru,
        2 => Lang::ZhCn,
        _ => Lang::En,
    }
}

/// `{n}` in a template filled with the nth value as JavaScript's String() writes it (null: empty).
pub fn fill(tmpl: &str, values: &[Value]) -> String {
    let mut out = String::with_capacity(tmpl.len());
    let mut rest = tmpl;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && after.as_bytes().get(digits) == Some(&b'}') {
            let i: usize = after[..digits].parse().unwrap_or(usize::MAX);
            if let Some(v) = values.get(i).filter(|v| !v.is_null()) {
                out.push_str(&js::string(v));
            }
            rest = &after[digits + 1..];
        } else {
            out.push('{');
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// The string in `lang`, filled with `values`.
pub fn t_in(lang: Lang, ru: &str, values: &[Value]) -> String {
    let translated = match lang {
        Lang::ZhCn => data::i18n_zh_cn().get(ru).or_else(|| data::i18n_en().get(ru)),
        _ => data::i18n_en().get(ru),
    };
    let tmpl = match (lang, translated) {
        (Lang::Ru, _) | (_, None) => ru,
        (_, Some(s)) => s.as_str(),
    };
    if values.is_empty() {
        tmpl.to_string()
    } else {
        fill(tmpl, values)
    }
}

/// The string in the current language.
pub fn t(ru: &str, values: &[Value]) -> String {
    t_in(lang(), ru, values)
}
