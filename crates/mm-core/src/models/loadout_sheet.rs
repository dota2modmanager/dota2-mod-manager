//! A texture's sprite-sheet sequences (src/loadout-sheet.ts): VTEX sprite-sheet metadata, laid out
//! as ValveResourceFormat's Texture.GetSpriteSheetData reads it (MIT,
//! https://github.com/ValveResourceFormat/ValveResourceFormat). The exporter writes the frames as
//! PNGs; this keeps the authored sequence ids and frame times for them.

use serde_json::{json, Value};

use crate::js::json_number;

struct At<'a>(&'a [u8]);

impl At<'_> {
    fn bytes<const N: usize>(&self, at: i64) -> Option<[u8; N]> {
        let at = usize::try_from(at).ok()?;
        self.0.get(at..at.checked_add(N)?)?.try_into().ok()
    }
    fn u16(&self, at: i64) -> Option<i64> {
        self.bytes::<2>(at).map(|b| u16::from_le_bytes(b) as i64)
    }
    fn u32(&self, at: i64) -> Option<i64> {
        self.bytes::<4>(at).map(|b| u32::from_le_bytes(b) as i64)
    }
    fn i32(&self, at: i64) -> Option<i64> {
        self.bytes::<4>(at).map(|b| i32::from_le_bytes(b) as i64)
    }
    fn f32(&self, at: i64) -> Option<f64> {
        self.bytes::<4>(at).map(|b| f32::from_le_bytes(b) as f64)
    }
    fn u8(&self, at: i64) -> Option<u8> {
        self.bytes::<1>(at).map(|b| b[0])
    }
}

fn read(file: &[u8]) -> Option<Value> {
    let data = At(crate::resource::data(file, "DATA", 0).ok()?);
    if data.u16(0)? != 1 {
        return Some(json!([]));
    }
    let first = 32 + data.u32(32)?;
    let n = data.u32(36)?;
    if n > 128 {
        return Some(json!([]));
    }
    for i in 0..n {
        let at = first + i * 12;
        if data.u32(at)? != 2 {
            continue;
        }
        let start = at + 4 + data.u32(at + 4)?;
        let size = data.u32(at + 8)?;
        // subarray: clamped to the block, never refused
        let len = data.0.len() as i64;
        let (s, e) = (start.min(len), (start + size).min(len).max(start.min(len)));
        let sheet = At(&data.0[s as usize..e as usize]);
        let seq_start = sheet.i32(0)?;
        let count = sheet.u32(4)?;
        if count > 512 {
            return Some(json!([]));
        }
        let mut seqs = Vec::new();
        for k in 0..count {
            let p = seq_start + k * 32;
            let id = sheet.u32(p)?;
            let clamp = sheet.u8(p + 4).is_some_and(|b| b != 0);
            let frames_at = p + 8 + sheet.i32(p + 8)?;
            let frames_count = sheet.u32(p + 12)?;
            if frames_count > 4096 || id > 1024 {
                return None;
            }
            let mut frames = Vec::new();
            for f in 0..frames_count {
                let at = frames_at + f * 12;
                let time = sheet.f32(at)?;
                let img = at + 4 + sheet.i32(at + 4)?;
                if sheet.u32(at + 8)? < 1 {
                    return None;
                }
                let crop = (0..4).map(|q| sheet.f32(img + q * 4)).collect::<Option<Vec<_>>>()?;
                let uv = (0..4).map(|q| sheet.f32(img + 16 + q * 4)).collect::<Option<Vec<_>>>()?;
                if !std::iter::once(time).chain(crop.iter().copied()).chain(uv.iter().copied()).all(f64::is_finite) {
                    return None;
                }
                let nums = |v: &[f64]| v.iter().map(|x| json_number(*x)).collect::<Vec<_>>();
                frames.push(json!({ "time": json_number(time), "uv": nums(&uv), "crop": nums(&crop) }));
            }
            seqs.push(json!({ "id": id, "clamp": clamp, "frames": frames }));
        }
        return Some(Value::Array(seqs));
    }
    Some(json!([]))
}

/// The sheet's sequences with their frames, or none for a texture without a readable sheet.
pub fn loadout_sheet(file: Option<&[u8]>) -> Value {
    // a missing sheet is reported by the packet exporter
    file.and_then(read).unwrap_or_else(|| json!([]))
}
