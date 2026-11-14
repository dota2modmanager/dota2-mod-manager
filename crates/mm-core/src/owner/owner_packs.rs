//! Combined packs: several mods merged into one pak slot, and taken apart again (src/ipc-packs.ts).
//! A pack holds a member list of its own, and every change to it rebuilds and redeploys its archive.

use serde_json::{json, Value};

use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::overlays::files_of;
use crate::owner::{arg, Core, Owner, R};
use crate::presets_service::packable_record;

pub const CHANNELS: &[&str] = &[
    "packs:combine",
    "packs:addMembers",
    "packs:setMemberEnabled",
    "packs:removeMember",
    "packs:extractMembers",
    "packs:disband",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| answer(o, channel, args))
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn id_of(v: &Value) -> String {
    v.get("id").map(crate::js::string).unwrap_or_default()
}

fn no_pack() -> Value {
    json!({ "error": t("Пак не найден", &[]) })
}

fn members(pack: &Value) -> Vec<Value> {
    pack.get("members").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// After any deploy with the master switch off, the files just written go off too.
pub fn after_deploy_master(c: &Core) {
    master_after_deploy(&c.installer);
}

fn master_after_deploy(inst: &Installer) {
    if inst.master_is_off().unwrap_or(false) {
        let _ = inst.set_master_enabled(false);
    }
}

/// Rebuild a pack's deployed VPK, keep its files and members, and put the pack's and the master
/// switch's off state back (src/services.ts deployAndApply): the conflicts the merge found.
pub fn deploy_and_apply(c: &mut Core, pack: &Value) -> Result<Value, String> {
    let Core { installer, library, .. } = c;
    deploy_into(installer, library, pack)
}

/// [`deploy_and_apply`] over the installer and the library alone.
pub fn deploy_into(inst: &Installer, lib: &mut Library, pack: &Value) -> Result<Value, String> {
    let out = inst.deploy_pack(pack)?;
    let files = out.get("files").cloned().unwrap_or(json!([]));
    lib.update(
        &pack["id"],
        &json!({ "files": files, "members": pack.get("members").cloned().unwrap_or(Value::Null) }),
        None,
    )
    .map_err(io)?;
    let list = files_of(&files);
    if pack.get("enabled") == Some(&Value::Bool(false)) && !list.is_empty() {
        let _ = inst.set_enabled(&list, false, None);
    }
    master_after_deploy(inst);
    Ok(out.get("conflicts").cloned().unwrap_or(json!([])))
}

/// A record's files taken out of the game, and the record gone: it lives on as a member.
fn absorb(c: &mut Core, pack_id: &str, rec: &Value) -> Result<Value, String> {
    let m = c.installer.add_pack_member_from_record(pack_id, rec, &uuid())?;
    let _ = c.installer.remove(&files_of(rec.get("files").unwrap_or(&Value::Null)), None, true);
    c.library.remove_record(&rec["id"], None).map_err(io)?;
    Ok(m)
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> R {
    let mut c = o.core();
    let run = |c: &mut Core| -> Result<Value, String> {
        if channel == "packs:combine" {
            return combine(c, &arg(args, 0));
        }
        let pack_id = arg(args, 0);
        let Some(mut pack) =
            c.library.find(&pack_id).filter(|p| p.get("kind").and_then(Value::as_str) == Some("pack")).cloned()
        else {
            return Ok(no_pack());
        };
        let pid = id_of(&pack);
        match channel {
            "packs:addMembers" => {
                let recs: Vec<Value> = arg(args, 1)
                    .as_array()
                    .map(|ids| {
                        ids.iter()
                            .filter_map(|id| c.library.find(id).cloned())
                            .filter(|r| packable_record(Some(r)))
                            .collect()
                    })
                    .unwrap_or_default();
                if recs.is_empty() {
                    return Ok(json!({ "error": t("Нет совместимых модов для добавления", &[]) }));
                }
                let mut list = members(&pack);
                for r in &recs {
                    list.push(absorb(c, &pid, r)?);
                }
                pack["members"] = Value::Array(list);
                let conflicts = deploy_and_apply(c, &pack)?;
                Ok(json!({ "ok": true, "pack": c.library.find(&pack_id), "added": recs.len(), "conflicts": conflicts }))
            }
            "packs:setMemberEnabled" => {
                let mut list = members(&pack);
                let Some(m) = list.iter_mut().find(|m| m.get("id") == Some(&arg(args, 1))) else {
                    return Ok(json!({ "error": t("Мод в паке не найден", &[]) }));
                };
                m["enabled"] = json!(crate::js::truthy(&arg(args, 2)));
                pack["members"] = Value::Array(list);
                let conflicts = deploy_and_apply(c, &pack)?;
                Ok(json!({ "ok": true, "conflicts": conflicts }))
            }
            "packs:removeMember" => {
                let mut list = members(&pack);
                let Some(idx) = list.iter().position(|m| m.get("id") == Some(&arg(args, 1))) else {
                    return Ok(json!({ "error": t("Мод в паке не найден", &[]) }));
                };
                let _ = std::fs::remove_file(c.installer.pack_member_file(&pid, &id_of(&list[idx])));
                list.remove(idx);
                if list.is_empty() {
                    c.installer.remove_pack_fully(&pack)?;
                    c.library.remove_record(&pack_id, None).map_err(io)?;
                    return Ok(json!({ "ok": true, "removedPack": true }));
                }
                pack["members"] = Value::Array(list);
                deploy_and_apply(c, &pack)?;
                Ok(json!({ "ok": true }))
            }
            "packs:extractMembers" => {
                let wanted: Vec<Value> = arg(args, 1).as_array().cloned().unwrap_or_default();
                let names = unpack_members(c, &pack, |m| wanted.contains(&m["id"]), true)?;
                let rest: Vec<Value> = members(&pack).into_iter().filter(|m| !wanted.contains(&m["id"])).collect();
                if rest.is_empty() {
                    c.installer.remove_pack_fully(&pack)?;
                    c.library.remove_record(&pack_id, None).map_err(io)?;
                    after_deploy_master(c);
                    return Ok(json!({ "ok": true, "count": names.len(), "names": names, "removedPack": true }));
                }
                pack["members"] = Value::Array(rest);
                deploy_and_apply(c, &pack)?;
                Ok(json!({ "ok": true, "count": names.len(), "names": names }))
            }
            "packs:disband" => {
                let names = unpack_members(c, &pack, |_| true, false)?;
                c.installer.remove_pack_fully(&pack)?;
                c.library.remove_record(&pack_id, None).map_err(io)?;
                after_deploy_master(c);
                Ok(json!({ "ok": true, "count": names.len(), "names": names }))
            }
            other => Err(format!("no handler for {other}")),
        }
    };
    Ok(run(&mut c).unwrap_or_else(|e| json!({ "error": e })))
}

/// Members turned back into standalone mods, each in a fresh slot: their names.
fn unpack_members(
    c: &mut Core,
    pack: &Value,
    pick: impl Fn(&Value) -> bool,
    drop_file: bool,
) -> Result<Vec<Value>, String> {
    let pid = id_of(pack);
    let mut names = Vec::new();
    for m in members(pack).into_iter().filter(|m| pick(m)) {
        let mid = id_of(&m);
        let files = c.installer.deploy_member_as_mod(&pid, &mid)?;
        let or_null = |k: &str| m.get(k).filter(|v| crate::js::truthy(v)).cloned().unwrap_or(Value::Null);
        let category = m.get("categoryId").filter(|v| crate::js::truthy(v)).cloned().unwrap_or(json!("imported"));
        let rec = c
            .library
            .add(
                &json!({
                    "name": m.get("name").cloned().unwrap_or(Value::Null), "categoryId": category,
                    "styleLabel": or_null("styleLabel"), "fileRef": pack.get("name").cloned().unwrap_or(Value::Null),
                    "preview": or_null("preview"), "files": crate::overlays::files_value(&files),
                }),
                None,
            )
            .map_err(io)?;
        if m.get("enabled") == Some(&Value::Bool(false)) {
            let _ = c.installer.set_enabled(&files, false, None);
            c.library.set_enabled(&rec["id"], false, None).map_err(io)?;
        }
        if drop_file {
            let _ = std::fs::remove_file(c.installer.pack_member_file(&pid, &mid));
        }
        names.push(m.get("name").cloned().unwrap_or(Value::Null));
    }
    Ok(names)
}

/// Any mix of standalone mods and packs into one pack: the first pack chosen takes the rest in,
/// its members and theirs rebuilt together into one slot.
fn combine(c: &mut Core, payload: &Value) -> Result<Value, String> {
    let recs: Vec<Value> = payload
        .get("modIds")
        .and_then(Value::as_array)
        .map(|ids| ids.iter().filter_map(|id| c.library.find(id).cloned()).collect())
        .unwrap_or_default();
    let is_pack = |r: &Value| r.get("kind").and_then(Value::as_str) == Some("pack");
    let packs: Vec<Value> = recs.iter().filter(|r| is_pack(r)).cloned().collect();
    let mods: Vec<Value> = recs.iter().filter(|r| packable_record(Some(r))).cloned().collect();
    let total = packs.iter().map(|p| members(p).len()).sum::<usize>() + mods.len();
    if total < 2 {
        return Ok(json!({ "error": t("Выбери минимум 2 мода (или пак и мод / два пака)", &[]) }));
    }
    let name = payload.get("name").and_then(Value::as_str).map(crate::js::trim).filter(|n| !n.is_empty());
    let mut target = match packs.first() {
        Some(p) => {
            let mut p = p.clone();
            if let Some(n) = name {
                p["name"] = json!(n);
            }
            p
        }
        None => c
            .library
            .add(
                &json!({
                    "name": name.map_or_else(|| t("Пак ({0})", &[json!(total)]), String::from),
                    "categoryId": "combined", "styleLabel": null, "fileRef": null, "preview": null, "files": [],
                    "kind": "pack", "members": [],
                }),
                None,
            )
            .map_err(io)?,
    };
    let tid = id_of(&target);
    std::fs::create_dir_all(c.installer.pack_folder(&tid)).map_err(io)?;
    let mut list = members(&target);
    for r in &mods {
        list.push(absorb(c, &tid, r)?);
    }
    for p in packs.iter().skip(1) {
        for m in members(p) {
            let src = c.installer.pack_member_file(&id_of(p), &id_of(&m));
            if !src.exists() {
                continue;
            }
            let new_id = uuid();
            std::fs::rename(&src, c.installer.pack_member_file(&tid, &new_id)).map_err(io)?;
            let mut m = m.clone();
            m["id"] = json!(new_id);
            list.push(m);
        }
        c.installer.remove_pack_fully(p)?;
        c.library.remove_record(&p["id"], None).map_err(io)?;
    }
    target["members"] = Value::Array(list);
    if let Some(n) = target.get("name").cloned() {
        c.library.update(&target["id"], &json!({ "name": n }), None).map_err(io)?;
    }
    let conflicts = deploy_and_apply(c, &target)?;
    Ok(json!({ "ok": true, "pack": c.library.find(&target["id"]), "conflicts": conflicts }))
}
