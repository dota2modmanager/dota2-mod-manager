//! The one window's size on the screen it opens on, the scale a first launch starts at, and the
//! keys that scale its content (src/main-window.ts). The shell (src-tauri) builds the window from
//! these; the reasons for each number are in the TypeScript's comments.

use serde_json::Value;

/// The UI scale, kept inside a range where the layout still holds together.
pub const ZOOM_MIN: f64 = 0.7;
/// 2.5 so a 3840 px screen at 100% Windows scaling can be filled (issue #388).
pub const ZOOM_MAX: f64 = 2.5;

/// Up to this many CSS pixels wide, a screen starts at scale 1.
const WIDE: f64 = 2000.0;

/// A work area in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub width: f64,
    pub height: f64,
}

/// The window's size and its minimums.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fit {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

/// The size this is designed at, and the smallest it still works at.
pub const DESIGNED: Fit = Fit { width: 1440.0, height: 900.0, min_width: 1020.0, min_height: 640.0 };

/// A scale the layout can take: anything else, including nonsense, becomes the nearest one or 1.
pub fn clamp_zoom(v: &Value) -> f64 {
    let z = crate::js::to_number(v);
    if !z.is_finite() || z <= 0.0 {
        return 1.0;
    }
    z.clamp(ZOOM_MIN, ZOOM_MAX)
}

fn usable(area: Option<Area>) -> Option<Area> {
    area.filter(|a| a.width > 0.0 && a.height > 0.0)
}

/// The window's size and minimums for a work area, or the designed size when there is none. A
/// scale above 1 on a screen wider than WIDE grows the window with its content.
pub fn window_fit(area: Option<Area>, scale: f64) -> Fit {
    let Some(a) = usable(area) else { return DESIGNED };
    let grow = if a.width > WIDE && scale > 1.0 { scale } else { 1.0 };
    Fit {
        width: crate::js::round(DESIGNED.width * grow).min(a.width),
        height: crate::js::round(DESIGNED.height * grow).min(a.height),
        min_width: DESIGNED.min_width.min(a.width),
        min_height: DESIGNED.min_height.min(a.height),
    }
}

/// The scale a first launch starts at (issue #388): above WIDE, about 80% of the scale that fills
/// the work area, in steps of 0.05.
pub fn start_scale(area: Option<Area>) -> f64 {
    let Some(a) = area.filter(|a| a.width > WIDE && a.height > 0.0) else { return 1.0 };
    let fills = (a.width / DESIGNED.width).min(a.height / DESIGNED.height);
    clamp_zoom(&Value::from(1f64.max((fills * 0.8 * 20.0).floor() / 20.0)))
}

/// A work area written "1366x728" (MM_WORKAREA), standing in for a smaller screen.
pub fn work_area_from(spec: Option<&str>) -> Option<Area> {
    let (w, h) = spec?.split_once('x')?;
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(w) || !digits(h) {
        return None;
    }
    Some(Area { width: w.parse().ok()?, height: h.parse().ok()? })
}

/// The scale a Ctrl chord turns `current` into, or None for any other key.
pub fn zoom_for(key: &str, current: f64) -> Option<f64> {
    match key {
        "=" | "+" => Some(clamp_zoom(&Value::from(current + 0.05))),
        "-" | "_" => Some(clamp_zoom(&Value::from(current - 0.05))),
        "0" => Some(1.0),
        _ => None,
    }
}

/// The scale a key event asks for: a Ctrl chord without Alt, on key down.
pub fn zoom_for_input(kind: &str, key: &str, control: bool, alt: bool, current: f64) -> Option<f64> {
    if kind != "keyDown" || !control || alt {
        return None;
    }
    zoom_for(key, current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_small_screen_shrinks_the_window_and_its_floor() {
        let f = window_fit(Some(Area { width: 1366.0, height: 728.0 }), 1.0);
        assert_eq!((f.width, f.height, f.min_width, f.min_height), (1366.0, 728.0, 1020.0, 640.0));
        assert_eq!(window_fit(None, 2.0), DESIGNED);
        assert_eq!(start_scale(Some(Area { width: 3840.0, height: 2100.0 })), 1.85);
        assert_eq!(start_scale(Some(Area { width: 2560.0, height: 1400.0 })), 1.2);
    }
}
