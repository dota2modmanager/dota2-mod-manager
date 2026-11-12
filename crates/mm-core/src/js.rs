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
