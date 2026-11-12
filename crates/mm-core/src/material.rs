//! A material's expressions, replacing src/material.ts: what an item's gem colours.
//!
//! A material can set a parameter from an expression the game evaluates, such as Terrorblade's
//! `g_vDetail1ColorTint = exists($GemColor) ? $GemColor : float3(0.35, 0.74, 1.0)`, compiled to the
//! bytecode ValveResourceFormat's VfxEval.cs (MIT) reads. Putting a constant where the expression
//! reads `$GemColor` gives the arcana the chosen colour and leaves the other branch as it was.
//!
//! Materials come in two containers: KV3, with the expressions in binary blobs, and the older NTRO,
//! a C struct its own NTRO block describes, where a new expression is added at the end of the data
//! and pointed to.

use std::collections::HashMap;

use crate::kv3::{self, Value};
use crate::resource;

/// Valve's hash of a name the expressions read (MurmurHash2 of the lowercased name, their seed).
pub fn attribute_token(name: &str) -> u32 {
    let lower = name.to_lowercase();
    let d = lower.as_bytes();
    let m: u32 = 0x5bd1_e995;
    let mut h: u32 = 0x3141_5926 ^ d.len() as u32;
    let (chunks, rest) = d.as_chunks::<4>();
    for c in chunks {
        let mut k = u32::from_le_bytes(*c).wrapping_mul(m);
        k ^= k >> 24;
        h = h.wrapping_mul(m) ^ k.wrapping_mul(m);
    }
    if rest.len() == 3 {
        h ^= (rest[2] as u32) << 16;
    }
    if rest.len() >= 2 {
        h ^= (rest[1] as u32) << 8;
    }
    if !rest.is_empty() {
        h = (h ^ rest[0] as u32).wrapping_mul(m);
    }
    h ^= h >> 13;
    h = h.wrapping_mul(m);
    h ^ (h >> 15)
}

/// How many operand bytes follow each opcode VfxEval.cs knows; anything else is refused.
fn operands(op: u8) -> Option<usize> {
    Some(match op {
        0x00 | 0x0c..=0x18 => 0,
        0x02 | 0x06 => 2,
        0x04 | 0x07 | 0x19 | 0x1d | 0x1f => 4,
        0x08 | 0x09 | 0x1a | 0x1e | 0x22 => 1,
        _ => return None,
    })
}

const RETURN: u8 = 0x00;
const JUMP: u8 = 0x02;
const BRANCH: u8 = 0x04;
const FUNC: u8 = 0x06;
const FLOAT: u8 = 0x07;
const ATTRIBUTE: u8 = 0x19;
const FLOAT3: u8 = 0x19;
const FLOAT4: u8 = 0x18;

/// The code that puts a constant (three or four numbers) on the stack.
fn constant_value(value: &[f64]) -> Vec<u8> {
    let mut out = Vec::with_capacity(value.len() * 5 + 3);
    for v in value {
        out.push(FLOAT);
        out.extend_from_slice(&(*v as f32).to_le_bytes());
    }
    out.extend_from_slice(&[FUNC, if value.len() == 4 { FLOAT4 } else { FLOAT3 }, 0]);
    out
}

/// An expression that is a constant (three or four numbers) and nothing else.
pub fn constant_expression(value: &[f64]) -> Vec<u8> {
    let mut out = constant_value(value);
    out.push(RETURN);
    out
}

/// The numbers of an expression that is a constant and nothing else, as constant_expression writes
/// one and as the Workshop Tools compile a colour typed in; None for anything else.
pub fn constant_of(code: &[u8]) -> Option<Vec<f64>> {
    for n in [3usize, 4] {
        let kind = if n == 4 { FLOAT4 } else { FLOAT3 };
        if code.len() != n * 5 + 4
            || code[n * 5] != FUNC
            || code[n * 5 + 1] != kind
            || code[n * 5 + 2] != 0
            || code[n * 5 + 3] != RETURN
        {
            continue;
        }
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            if code[i * 5] != FLOAT {
                return None;
            }
            out.push(f32::from_le_bytes(code[i * 5 + 1..i * 5 + 5].try_into().unwrap()) as f64);
        }
        return Some(out);
    }
    None
}

/// An expression with every read of one attribute replaced by a constant (three or four numbers),
/// its jumps moved to where their targets now are. None when it reads no such attribute or holds
/// an opcode not known; an error where a jump would land past what two bytes can say.
pub fn with_constant(code: &[u8], token: u32, value: &[f64]) -> Result<Option<Vec<u8>>, String> {
    let mut ops: Vec<(usize, &[u8])> = Vec::new();
    let mut i = 0;
    while i < code.len() {
        let Some(n) = operands(code[i]) else { return Ok(None) };
        if i + 1 + n > code.len() {
            return Ok(None);
        }
        ops.push((i, &code[i..i + 1 + n]));
        i += 1 + n;
    }
    let constant = constant_value(value);
    let mut found = false;
    let mut next: Vec<Vec<u8>> = ops
        .iter()
        .map(|(_, b)| {
            if b[0] == ATTRIBUTE && u32::from_le_bytes(b[1..5].try_into().unwrap()) == token {
                found = true;
                constant.clone()
            } else {
                b.to_vec()
            }
        })
        .collect();
    if !found {
        return Ok(None);
    }
    let mut moved: HashMap<usize, usize> = HashMap::new();
    let mut at = 0;
    for (k, (from, _)) in ops.iter().enumerate() {
        moved.insert(*from, at);
        at += next[k].len();
    }
    moved.insert(code.len(), at);
    for (k, (_, b)) in ops.iter().enumerate() {
        let targets: &[usize] = match b[0] {
            JUMP => &[1],
            BRANCH => &[1, 3],
            _ => &[],
        };
        for &t in targets {
            let Some(&to) = moved.get(&(u16::from_le_bytes([b[t], b[t + 1]]) as usize)) else { return Ok(None) };
            let to = u16::try_from(to).map_err(|_| format!("material: a jump to {to}"))?;
            next[k][t..t + 2].copy_from_slice(&to.to_le_bytes());
        }
    }
    Ok(Some(next.concat()))
}

/// A material parameter set by an expression: its name and bytecode.
#[derive(Debug, Clone, PartialEq)]
pub struct Expression {
    pub name: String,
    pub code: Vec<u8>,
}

fn u32_at(f: &[u8], at: i64) -> Result<u32, String> {
    usize::try_from(at)
        .ok()
        .and_then(|a| f.get(a..a + 4))
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
        .ok_or_else(|| format!("material: a read at {at} past the file"))
}

fn u16_at(f: &[u8], at: i64) -> Result<u16, String> {
    usize::try_from(at)
        .ok()
        .and_then(|a| f.get(a..a + 2))
        .map(|s| u16::from_le_bytes([s[0], s[1]]))
        .ok_or_else(|| format!("material: a read at {at} past the file"))
}

/// A string up to its zero byte, "" where there is none.
fn cstr(f: &[u8], at: i64) -> String {
    let Ok(at) = usize::try_from(at) else { return String::new() };
    let Some(rest) = f.get(at..) else { return String::new() };
    match rest.iter().position(|&b| b == 0) {
        Some(end) => rest[..end].iter().map(|&b| b as char).collect(),
        None => String::new(),
    }
}

struct Struct {
    size: u16,
    fields: HashMap<String, i16>,
}

/// The fields of the NTRO structs a material needs, by struct name.
fn ntro_structs(file: &[u8], ntro: i64) -> Result<HashMap<String, Struct>, String> {
    let list = ntro + 4 + u32_at(file, ntro + 4)? as i64;
    let mut by_id: HashMap<u32, (String, u16, u32, HashMap<String, i16>)> = HashMap::new();
    let mut order: Vec<u32> = Vec::new();
    for i in 0..u32_at(file, ntro + 8)? as i64 {
        let s = list + i * 40;
        let mut fields = HashMap::new();
        let field_list = s + 28 + u32_at(file, s + 28)? as i64;
        for j in 0..u32_at(file, s + 32)? as i64 {
            let q = field_list + j * 24;
            fields.insert(cstr(file, q + u32_at(file, q)? as i64), u16_at(file, q + 6)? as i16);
        }
        let id = u32_at(file, s + 4)?;
        let name = cstr(file, s + 8 + u32_at(file, s + 8)? as i64);
        let (size, base) = (u16_at(file, s + 20)?, u32_at(file, s + 24)?);
        if by_id.insert(id, (name, size, base, fields)).is_none() {
            order.push(id);
        }
    }
    let mut out = HashMap::new();
    for id in order {
        let (name, size, base, own) = &by_id[&id];
        let mut fields = own.clone();
        let mut b = by_id.get(base);
        // a chain of bases that comes back on itself has no end to find
        for _ in 0..by_id.len() {
            let Some((_, _, next, inherited)) = b else { break };
            for (k, v) in inherited {
                fields.entry(k.clone()).or_insert(*v);
            }
            b = by_id.get(next);
        }
        out.insert(name.clone(), Struct { size: *size, fields });
    }
    Ok(out)
}

struct NtroExpression {
    name: String,
    code: Vec<u8>,
    pointer: usize,
}

/// Where an NTRO material keeps its dynamic parameters: for each, its name, its bytecode, and the
/// place of the bytecode's pointer and length (the pointer counts from its own position).
fn ntro_expressions(file: &[u8]) -> Result<Vec<NtroExpression>, String> {
    let blocks = resource::blocks(file).map_err(|e| e.to_string())?;
    let (Some(ntro), Some(data)) = (blocks.iter().find(|b| b.name == "NTRO"), blocks.iter().find(|b| b.name == "DATA"))
    else {
        return Err("material: no NTRO or DATA block".into());
    };
    let structs = ntro_structs(file, ntro.at as i64)?;
    let root = structs.get("MaterialResourceData_t");
    let param = structs.get("MaterialParamBuffer_t");
    let list = root.and_then(|r| r.fields.get("m_dynamicParams"));
    let (Some(param), Some(&list)) = (param, list) else {
        return Err("material: not the struct a material has".into());
    };
    let (Some(&name), Some(&value)) = (param.fields.get("m_name"), param.fields.get("m_value")) else {
        return Err("material: not the struct a material has".into());
    };
    let array_at = data.at as i64 + list as i64;
    let first = array_at + u32_at(file, array_at)? as i64;
    let mut out = Vec::new();
    for k in 0..u32_at(file, array_at + 4)? as i64 {
        let e = first + k * param.size as i64;
        let name_at = e + name as i64 + u32_at(file, e + name as i64)? as i64;
        let pointer = e + value as i64;
        let code_at = pointer + u32_at(file, pointer)? as i64;
        let len = u32_at(file, pointer + 4)? as i64;
        // a slice past the end is cut where the file ends, as Buffer.subarray cuts it
        let clamp = |x: i64| x.clamp(0, file.len() as i64) as usize;
        let (a, b) = (clamp(code_at), clamp(code_at + len));
        out.push(NtroExpression {
            name: cstr(file, name_at),
            code: file[a..b.max(a)].to_vec(),
            pointer: pointer as usize,
        });
    }
    Ok(out)
}

fn is_ntro(file: &[u8]) -> Result<bool, String> {
    Ok(resource::blocks(file).map_err(|e| e.to_string())?.iter().any(|b| b.name == "NTRO"))
}

/// A KV3 material's block and its dynamic parameters, each as its name and blob index.
fn kv3_expressions(file: &[u8]) -> Result<(kv3::Block, Vec<(String, usize)>), String> {
    let kv = kv3::read(resource::data_block(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let out = kv
        .root
        .get("m_dynamicParams")
        .map(|l| l.items())
        .unwrap_or(&[])
        .iter()
        .filter_map(|p| {
            let name = p.get("m_name")?.as_str()?.to_string();
            match p.get("m_value")?.value {
                Value::Blob(i) => Some((name, i)),
                _ => None,
            }
        })
        .collect();
    Ok((kv, out))
}

/// A material's expressions, whichever container it is in.
pub fn material_expressions(file: &[u8]) -> Result<Vec<Expression>, String> {
    if is_ntro(file)? {
        return Ok(ntro_expressions(file)?.into_iter().map(|e| Expression { name: e.name, code: e.code }).collect());
    }
    let (kv, out) = kv3_expressions(file)?;
    Ok(out.into_iter().map(|(name, i)| Expression { name, code: kv.blobs[i].clone() }).collect())
}

/// The material with some expressions rewritten (`change` gives new bytecode, or None to keep
/// one), and how many changed.
pub fn rewrite_expressions(
    file: &[u8],
    mut change: impl FnMut(&Expression) -> Result<Option<Vec<u8>>, String>,
) -> Result<(Vec<u8>, usize), String> {
    let mut changed = 0;
    if is_ntro(file)? {
        let mut data = resource::data_block(file).map_err(|e| e.to_string())?.to_vec();
        let start = resource::blocks(file)
            .map_err(|e| e.to_string())?
            .iter()
            .find(|b| b.name == "DATA")
            .map(|b| b.at)
            .unwrap_or(0);
        let mut added: Vec<Vec<u8>> = Vec::new();
        let mut end = data.len();
        for e in ntro_expressions(file)? {
            let Some(code) = change(&Expression { name: e.name, code: e.code })? else { continue };
            // the new code goes after the data, pointed to from where the old pointer was
            let pointer = e
                .pointer
                .checked_sub(start)
                .filter(|p| p + 8 <= data.len() && *p <= end)
                .ok_or("material: a pointer outside the data")?;
            data[pointer..pointer + 4]
                .copy_from_slice(&u32::try_from(end - pointer).map_err(|e| e.to_string())?.to_le_bytes());
            data[pointer + 4..pointer + 8].copy_from_slice(&(code.len() as u32).to_le_bytes());
            end += code.len();
            added.push(code);
            changed += 1;
        }
        if changed == 0 {
            return Ok((file.to_vec(), 0));
        }
        data.extend(added.concat());
        return Ok((resource::replace(file, "DATA", 0, &data).map_err(|e| e.to_string())?, changed));
    }
    let (mut kv, out) = kv3_expressions(file)?;
    for (name, i) in out {
        let Some(code) = change(&Expression { name, code: kv.blobs[i].clone() })? else { continue };
        kv.blobs[i] = code;
        changed += 1;
    }
    if changed == 0 {
        return Ok((file.to_vec(), 0));
    }
    let next = kv.encode().map_err(|e| e.to_string())?;
    Ok((resource::replace(file, "DATA", 0, &next).map_err(|e| e.to_string())?, changed))
}
