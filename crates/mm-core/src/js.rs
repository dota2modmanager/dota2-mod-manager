//! What JavaScript does to a value where the TypeScript relied on it, so a port answers the same.

use serde_json::Value;

/// A number as JavaScript's String() writes it: no ".0" on whole numbers, an exponent from 1e21
/// and below 1e-6, the shortest digits that read back as the same number.
pub fn number(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if n == 0.0 {
        return "0".into();
    }
    // the shortest round-trip digits and the exponent, from Rust's own `{:e}`
    let e = format!("{:e}", n.abs());
    let (mant, exp) = e.split_once('e').unwrap_or((&e, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let digits: String = mant.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i32;
    // n = 0.digits * 10^point
    let point = exp + 1;
    let body = if k <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - k) as usize))
    } else if 0 < point && point <= 21 {
        format!("{}.{}", &digits[..point as usize], &digits[point as usize..])
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let e = point - 1;
        let es = if e >= 0 { format!("+{e}") } else { e.to_string() };
        if k == 1 {
            format!("{digits}e{es}")
        } else {
            format!("{}.{}e{es}", &digits[..1], &digits[1..])
        }
    };
    if n < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

/// A value as String() writes it.
pub fn string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(a) => {
            a.iter().map(|x| if x.is_null() { String::new() } else { string(x) }).collect::<Vec<_>>().join(",")
        }
        Value::Object(_) => "[object Object]".into(),
    }
}

/// Whether a value is truthy.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JavaScript's \w: an ASCII letter, digit or underscore.
pub fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Number(v): what JavaScript makes of a value asked for as a number.
pub fn to_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => *b as u8 as f64,
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => str_number(s),
        Value::Array(a) if a.is_empty() => 0.0,
        Value::Array(a) if a.len() == 1 => str_number(&string(&a[0])),
        _ => f64::NAN,
    }
}

fn str_number(s: &str) -> f64 {
    let t = s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if t.is_empty() {
        return 0.0;
    }
    let (sign, rest) = match t.as_bytes()[0] {
        b'-' => (-1.0, &t[1..]),
        b'+' => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    if rest == "Infinity" {
        return sign * f64::INFINITY;
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(d) = t.strip_prefix(prefix) {
            return u64::from_str_radix(d, radix).map_or(f64::NAN, |n| n as f64);
        }
    }
    let ok =
        !rest.is_empty() && rest.bytes().all(|c| c.is_ascii_digit() || matches!(c, b'.' | b'e' | b'E' | b'+' | b'-'));
    if ok {
        rest.parse::<f64>().map_or(f64::NAN, |n| sign * n)
    } else {
        f64::NAN
    }
}

/// A number as JSON.stringify writes it: null for NaN and the infinities, 0 for -0, whole numbers
/// without a fraction.
pub fn json_number(n: f64) -> Value {
    if !n.is_finite() {
        return Value::Null;
    }
    if n == 0.0 {
        return Value::from(0);
    }
    if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        return Value::from(n as i64);
    }
    Value::from(n)
}

/// Math.hypot as V8 computes it: the values over the largest, their squares summed with Kahan's
/// compensation, so that a port measures the same last bit.
pub fn hypot(values: &[f64]) -> f64 {
    let mut max = 0.0f64;
    for v in values {
        let a = v.abs();
        if a.is_infinite() {
            return f64::INFINITY;
        }
        if a.is_nan() {
            return f64::NAN;
        }
        max = max.max(a);
    }
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for v in values {
        let n = v.abs() / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// What (x).toFixed(digits) gives: rounded on the exact value, a tie going away from zero.
pub fn to_fixed(x: f64, digits: usize) -> String {
    if !x.is_finite() || x.abs() >= 1e21 {
        return number(x);
    }
    // a double's exact decimal ends within 1074 places, so this is the value itself
    let exact = format!("{:.1100}", x.abs());
    let (int, frac) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut d: Vec<u8> = int.bytes().chain(frac.bytes().take(digits)).collect();
    if frac.as_bytes().get(digits).is_some_and(|c| *c >= b'5') {
        let mut i = d.len();
        loop {
            if i == 0 {
                d.insert(0, b'1');
                break;
            }
            i -= 1;
            if d[i] == b'9' {
                d[i] = b'0';
            } else {
                d[i] += 1;
                break;
            }
        }
    }
    let cut = d.len() - digits;
    let mut out = String::from(if x < 0.0 { "-" } else { "" });
    out += std::str::from_utf8(&d[..cut]).unwrap_or("0");
    if digits > 0 {
        out.push('.');
        out += std::str::from_utf8(&d[cut..]).unwrap_or("");
    }
    out
}

/// What a.localeCompare(b) gives in Node with no locale named: ICU's root collation (the app's
/// default locale, en, has no tailoring of its own).
pub fn locale_compare(a: &str, b: &str) -> std::cmp::Ordering {
    use icu_collator::{options::CollatorOptions, Collator, CollatorBorrowed};
    static C: std::sync::OnceLock<CollatorBorrowed<'static>> = std::sync::OnceLock::new();
    C.get_or_init(|| Collator::try_new(Default::default(), CollatorOptions::default()).expect("ICU's root collation"))
        .compare(a, b)
}

/// What /\s/ and String.prototype.trim take for white space: the ASCII gaps, line terminators,
/// U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF.
pub fn is_space(c: char) -> bool {
    matches!(c, '\t'..='\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// String.prototype.trim.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// The class /\s/ matches, for a regex pattern.
pub const SPACE_CLASS: &str =
    r"[\t-\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]";

/// A string split as s.split(/\r?\n/) splits it.
pub fn lines(s: &str) -> Vec<&str> {
    s.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect()
}

/// A folder's entries in the order fs.readdirSync gives them: the system's own on Windows, and by
/// bytes elsewhere, because libuv sorts what it lists there and the std listing does not.
pub fn read_dir(dir: &std::path::Path) -> std::io::Result<Vec<std::fs::DirEntry>> {
    let mut all: Vec<std::fs::DirEntry> = std::fs::read_dir(dir)?.collect::<std::io::Result<_>>()?;
    if !cfg!(windows) {
        all.sort_by(|a, b| a.file_name().as_encoded_bytes().cmp(b.file_name().as_encoded_bytes()));
    }
    Ok(all)
}

/// The names in a folder, in readdirSync's order; an unreadable folder has none.
pub fn dir_names(dir: &std::path::Path) -> Vec<String> {
    read_dir(dir).map(|d| d.iter().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default()
}

/// Is this key an array index, which a JavaScript object lists first, in ascending order?
fn index_key(k: &str) -> Option<u32> {
    let n: u32 = k.parse().ok()?;
    (n != u32::MAX && n.to_string() == k).then_some(n)
}

/// An object's keys in the order JavaScript walks them: array indexes ascending, then the rest as
/// they were inserted.
pub fn keys(o: &serde_json::Map<String, Value>) -> Vec<&String> {
    let mut idx: Vec<(u32, &String)> = o.keys().filter_map(|k| index_key(k).map(|n| (n, k))).collect();
    idx.sort_by_key(|(n, _)| *n);
    idx.into_iter().map(|(_, k)| k).chain(o.keys().filter(|k| index_key(k).is_none())).collect()
}

/// JSON.stringify(v, null, indent): JavaScript's key order and its numbers.
pub fn stringify(v: &Value, indent: &str) -> String {
    fn go(v: &Value, indent: &str, at: &str, out: &mut String) {
        let inner = format!("{at}{indent}");
        let (nl, sep) = if indent.is_empty() { ("", ":") } else { ("\n", ": ") };
        match v {
            Value::Number(n) => out.push_str(&number(n.as_f64().unwrap_or(f64::NAN))),
            Value::Array(a) if a.is_empty() => out.push_str("[]"),
            Value::Array(a) => {
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    out.push_str(if i > 0 { "," } else { "" });
                    out.push_str(nl);
                    out.push_str(&inner);
                    go(x, indent, &inner, out);
                }
                out.push_str(nl);
                out.push_str(at);
                out.push(']');
            }
            Value::Object(o) if o.is_empty() => out.push_str("{}"),
            Value::Object(o) => {
                out.push('{');
                for (i, k) in keys(o).into_iter().enumerate() {
                    out.push_str(if i > 0 { "," } else { "" });
                    out.push_str(nl);
                    out.push_str(&inner);
                    out.push_str(&serde_json::to_string(k).unwrap_or_default());
                    out.push_str(sep);
                    go(&o[k], indent, &inner, out);
                }
                out.push_str(nl);
                out.push_str(at);
                out.push('}');
            }
            other => out.push_str(&serde_json::to_string(other).unwrap_or_default()),
        }
    }
    let mut out = String::new();
    go(v, indent, "", &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_read_as_javascript_writes_them() {
        for (n, s) in [
            (1.0, "1"),
            (-2.5, "-2.5"),
            (0.1, "0.1"),
            (1e21, "1e+21"),
            (1.5e-7, "1.5e-7"),
            (123456.789, "123456.789"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (2e22, "2e+22"),
            (1e20, "100000000000000000000"),
            (0.30000000000000004, "0.30000000000000004"),
        ] {
            assert_eq!(number(n), s, "{n}");
        }
    }
}
