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
    absorb_into(&c.installer, &mut c.library, pack_id, rec)
}

fn absorb_into(inst: &Installer, lib: &mut Library, pack_id: &str, rec: &Value) -> Result<Value, String> {
    let m = inst.add_pack_member_from_record(pack_id, rec, &uuid())?;
    let _ = inst.remove(&files_of(rec.get("files").unwrap_or(&Value::Null)), None, true);
    lib.remove_record(&rec["id"], None).map_err(io)?;
    Ok(m)
}

// ---------- the shared pack: room made by itself when the pak slots run out ----------
//
// Dota reads pak01-pak99 from the language folder and nothing past it, so about sixty mods of the
// usual zone fill the order. Installing the sixty-first from a long list used to fail with "no
// free pakNN slots" over and over, one red toast per mod, and the mods that did not fit were gone
// from the list. People asked in Discord with a screenshot of the toast, five of them in a week.
//
// Now, when an install would leave fewer than ROOM_LOW slots free, mods already in the game are
// folded into one pack, "Shared pack", until ROOM_BATCH slots are free again. A pack is one slot
// whatever it holds, and each mod in it still switches on and off by itself in My mods. Folded
// first are the mods that are off (they do nothing in the game, so nothing changes there), then
// the newest. Never folded: a mod in a priority slot (its place in the order is the point of it),
// a mod the app builds itself, a mod a saved preset names (the preset finds mods by their record),
// and anything that is not a plain pak.
//
// Somebody who wants the order in their own hands turns it off in Settings (`autoPack`), and gets
// the old message, which now also says where the switch is.

/// Folding starts when an install would leave fewer free slots than this: the last one, and one more.
pub const ROOM_LOW: usize = 2;
/// Free slots one round of folding leaves, so the pack is rebuilt once in several installs.
pub const ROOM_AFTER: usize = 10;

/// Whether the app may fold mods into the shared pack by itself (on unless turned off).
pub fn auto_pack_on(settings: &crate::settings::Settings) -> bool {
    settings.get("autoPack") != Some(&Value::Bool(false))
}

fn is_auto_pack(r: &Value) -> bool {
    r.get("kind").and_then(Value::as_str) == Some("pack") && r.get("auto") == Some(&Value::Bool(true))
}

/// The pack and the member that hold a mod, when it was folded into a pack.
pub fn packed<'a>(lib: &'a Library, category: &Value, name: &Value, style: Option<&Value>) -> Option<&'a Value> {
    let style = style.filter(|s| !s.is_null() && crate::js::truthy(s));
    lib.list().iter().filter(|r| r.get("kind").and_then(Value::as_str) == Some("pack")).find(|p| {
        members(p).iter().any(|m| {
            m.get("categoryId") == Some(category)
                && m.get("name") == Some(name)
                && m.get("styleLabel").filter(|s| !s.is_null() && crate::js::truthy(s)) == style
        })
    })
}

/// A record that can go into the shared pack: plain paks in the usual zone, nothing the app builds.
fn foldable(inst: &Installer, kept: &std::collections::HashSet<String>, r: &Value) -> bool {
    static PAK: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pak = PAK.get_or_init(|| regex::Regex::new(r"(?i)^pak\d+_(dir|\d{3})\.vpk$").unwrap());
    let files = r.get("files").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    packable_record(Some(r))
        && !r.get("generated").is_some_and(crate::js::truthy)
        && !kept.contains(&id_of(r))
        && !files.is_empty()
        && files.iter().all(|f| {
            f.get("root").and_then(Value::as_str) == Some("lang")
                && f.get("relPath").and_then(Value::as_str).is_some_and(|p| pak.is_match(p))
        })
        && inst.slot_number(r).is_some_and(|n| n >= crate::slot_zones::NORMAL_FIRST)
}

/// Free slots an install into `priority` (or the usual zone) can take.
fn room_for(inst: &Installer, priority: bool) -> Result<usize, String> {
    use crate::slot_zones::{free_slots, Zone};
    let used = inst.used_pak_names()?;
    Ok(free_slots(Zone::Normal, &used) + if priority { free_slots(Zone::Priority, &used) } else { 0 })
}

/// Before `need` installs: when the slots are about to run out, fold mods into the shared pack.
/// Answers the names folded (none when there was room, or the switch is off).
pub fn make_room(
    inst: &Installer,
    lib: &mut Library,
    on: bool,
    priority: bool,
    need: usize,
) -> Result<Vec<Value>, String> {
    if !on || inst.lang_folder().map_or(true, |l| !l.is_dir()) {
        return Ok(Vec::new());
    }
    let free = room_for(inst, priority)?;
    if free >= need + ROOM_LOW - 1 {
        return Ok(Vec::new());
    }
    let kept: std::collections::HashSet<String> = lib
        .list_presets()
        .iter()
        .flat_map(|p| lib.preset_mod_ids(Some(p)).unwrap_or_default())
        .map(|id| crate::js::string(&id))
        .collect();
    let mut pick: Vec<Value> = lib.list().iter().filter(|r| foldable(inst, &kept, r)).cloned().collect();
    // the ones that are off first (the game does not see them), then the newest
    let at = |r: &Value| r.get("installedAt").and_then(Value::as_f64).unwrap_or(0.0);
    pick.sort_by(|a, b| {
        let off = |r: &Value| r.get("enabled") == Some(&Value::Bool(false));
        off(b).cmp(&off(a)).then(at(b).total_cmp(&at(a)))
    });
    let existing = lib.list().iter().find(|r| is_auto_pack(r)).cloned();
    // a new pack takes one of the slots it frees
    let want = ROOM_AFTER.max(need + ROOM_LOW) - free + usize::from(existing.is_none());
    pick.truncate(want);
    if pick.is_empty() || (existing.is_none() && pick.len() < 2) {
        return Ok(Vec::new());
    }
    let mut pack = match existing {
        Some(p) => p,
        None => {
            let p = lib
                .add(
                    &json!({
                        "name": t("Общий пак", &[]), "categoryId": "combined", "styleLabel": null, "fileRef": null,
                        "preview": null, "files": [], "kind": "pack", "members": [],
                    }),
                    None,
                )
                .map_err(io)?;
            lib.update(&p["id"], &json!({ "auto": true }), None).map_err(io)?.unwrap_or(p)
        }
    };
    let pid = id_of(&pack);
    std::fs::create_dir_all(inst.pack_folder(&pid)).map_err(io)?;
    let mut list = members(&pack);
    let mut names = Vec::new();
    for r in &pick {
        list.push(absorb_into(inst, lib, &pid, r)?);
        names.push(r.get("name").cloned().unwrap_or(Value::Null));
    }
    pack["members"] = Value::Array(list);
    deploy_into(inst, lib, &pack)?;
    Ok(names)
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

#[cfg(test)]
mod shared_pack_tests {
    use super::*;
    use crate::slot_zones::{free_slots, pak_base, Zone, APP_PAK, NORMAL_FIRST};

    /// A game whose usual zone has one slot left, every other one a mod of the library's, plus a
    /// mod in a priority slot, one the app built, and one a saved preset names.
    fn full_game() -> (std::path::PathBuf, Installer, Library) {
        let root = std::env::temp_dir().join(format!("mm-shared-pack-{}", uuid::Uuid::new_v4().simple()));
        let lang = root.join("game").join("dota_russian");
        std::fs::create_dir_all(&lang).unwrap();
        std::fs::create_dir_all(root.join("game").join("dota")).unwrap();
        std::fs::write(root.join("game").join("dota").join("pak01_dir.vpk"), crate::vpk::build(&[])).unwrap();
        let ud = root.join("ud");
        std::fs::create_dir_all(&ud).unwrap();
        let slots: Vec<u32> =
            (NORMAL_FIRST..=99).filter(|n| !crate::minify::RESERVED_PAKS.contains(n) && *n != APP_PAK).collect();
        let mut installed = Vec::new();
        let mut put = |n: u32, extra: Value| {
            let file = format!("{}_dir.vpk", pak_base(n));
            let body = format!("mod {n}").into_bytes();
            std::fs::write(
                lang.join(&file),
                crate::vpk::build(&[crate::vpk::entry_at(&format!("materials/mod{n}.vtex_c"), body.into())]),
            )
            .unwrap();
            let mut rec = json!({ "id": format!("m{n}"), "name": format!("Mod {n}"), "categoryId": "heroes",
                "styleLabel": null, "enabled": !n.is_multiple_of(10), "installedAt": n,
                "files": [{ "root": "lang", "relPath": file }] });
            if let (Some(r), Some(e)) = (rec.as_object_mut(), extra.as_object()) {
                r.extend(e.clone());
            }
            installed.push(rec);
        };
        put(5, json!({ "categoryId": "trees" }));
        for (i, n) in slots[..slots.len() - 1].iter().enumerate() {
            put(*n, if i == slots.len() - 2 { json!({ "generated": { "map": true } }) } else { json!({}) });
        }
        let presets = json!([{ "id": "p1", "name": "Mine", "modIds": [format!("m{}", slots[slots.len() - 3])] }]);
        std::fs::write(ud.join("manifest.json"), json!({ "installed": installed, "presets": presets }).to_string())
            .unwrap();
        let mut inst = Installer::new(Some(root.join("game")), "russian");
        inst.user_data = ud.clone();
        (root, inst, Library::new(&ud))
    }

    #[test]
    fn the_last_free_slot_folds_mods_into_one_shared_pack_and_leaves_room() {
        let (root, inst, mut lib) = full_game();
        let before = free_slots(Zone::Normal, &inst.used_pak_names().unwrap());
        assert_eq!(before, 1);
        let names = make_room(&inst, &mut lib, true, false, 1).unwrap();
        let free = free_slots(Zone::Normal, &inst.used_pak_names().unwrap());
        assert!(free >= ROOM_AFTER, "{free} free after folding {names:?}");

        let pack = lib.list().iter().find(|r| is_auto_pack(r)).cloned().expect("the shared pack");
        let held = members(&pack);
        assert_eq!(held.len(), names.len());
        // the mods that are off went in first, and keep their state
        let off: Vec<&Value> = held.iter().filter(|m| m["enabled"] == json!(false)).collect();
        assert!(off.len() >= 6, "{held:?}");
        // never folded: the priority slot, the mod the app built, the one a preset names
        {
            let kept = "m5";
            assert!(lib.find(&json!(kept)).is_some(), "{kept} stays where it is");
        }
        assert!(lib.list().iter().any(|r| r.get("generated").is_some()), "the built mod stays");
        let named = lib.list_presets()[0]["modIds"][0].clone();
        assert!(lib.find(&named).is_some(), "the preset's mod stays");
        // a folded mod is still installed as far as the catalog asks, and still in the game
        let m = &held.iter().find(|m| m["enabled"] == json!(true)).expect("an enabled one");
        assert!(packed(&lib, &m["categoryId"], &m["name"], None).is_some());
        let base = Installer::pack_base(&files_of(&pack["files"])).expect("the pack is deployed");
        let lang = inst.lang_folder().unwrap();
        let paths = crate::vpk::list_paths(&std::fs::read(lang.join(format!("{base}_dir.vpk"))).unwrap()).unwrap();
        let n = m["name"].as_str().unwrap().trim_start_matches("Mod ");
        assert!(paths.iter().any(|p| p == &format!("materials/mod{n}.vtex_c")), "{paths:?}");

        // room enough: the next install folds nothing, and a second round adds to the same pack
        assert!(make_room(&inst, &mut lib, true, false, 1).unwrap().is_empty());
        let more = make_room(&inst, &mut lib, true, false, free + 1).unwrap();
        assert!(!more.is_empty());
        assert_eq!(lib.list().iter().filter(|r| is_auto_pack(r)).count(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn with_the_switch_off_nothing_is_folded() {
        let (root, inst, mut lib) = full_game();
        let count = lib.list().len();
        assert!(make_room(&inst, &mut lib, false, false, 1).unwrap().is_empty());
        assert_eq!(lib.list().len(), count);
        assert!(lib.list().iter().all(|r| !is_auto_pack(r)));
        let _ = std::fs::remove_dir_all(&root);
    }
}
