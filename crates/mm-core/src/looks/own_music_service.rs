//! The user's own songs as the game's background music, one record in My mods (the events are
//! own_music.rs). A song is kept in userData/own-music by its sha1 as the user gave it (MP3) or as
//! the window made it (16-bit PCM WAV), so the record can be built again with nothing asked of the
//! user. A build runs Valve's compiler over the songs and every music pack's events, as a sound of
//! the user's own does (ability_sounds_service.rs).

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha1::{Digest, Sha1};

use crate::ability_sounds_service::Compile;
use crate::generated_pak::{files_json, files_of, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::own_music::{music_events, pack_events, song_kind, song_path, Plan};
use crate::resource_compiler::{CompileJob, SourceFile};
use crate::vpk::Entry;

/// The most one song may weigh: ten minutes of stereo WAV.
pub const MAX_SONG: usize = 112 * 1024 * 1024;
/// The most songs one record carries.
pub const MAX_SONGS: usize = 60;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn id_ok(id: &str) -> bool {
    id.len() == 40 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn record_of(lib: &Library) -> Option<Value> {
    lib.list().iter().find(|r| r["generated"]["music"] == Value::Bool(true)).cloned()
}

/// Where the calm songs play: the menu, and the calm music of a match. Songs marked for fights
/// or for Roshan play there wherever these say.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Places {
    pub menu: bool,
    pub game: bool,
}

/// The service the music:* channels call, over the user's folder and the game.
pub struct OwnMusic {
    store: PathBuf,
    game: Option<PathBuf>,
}

impl OwnMusic {
    pub fn new(user_data: &Path, game: Option<PathBuf>) -> Self {
        OwnMusic { store: user_data.join("own-music"), game }
    }

    fn kept(&self, id: &str) -> Option<(PathBuf, &'static str)> {
        ["mp3", "wav"].into_iter().map(|e| (self.store.join(format!("{id}.{e}")), e)).find(|(p, _)| p.exists())
    }

    /// A song kept for a build to come; its id.
    pub fn keep(&self, bytes: &[u8]) -> Result<String, String> {
        if bytes.len() > MAX_SONG {
            return Err(t("Песня больше {0} МБ", &[json!(MAX_SONG / 1024 / 1024)]));
        }
        let kind = song_kind(bytes).ok_or_else(|| t("Нужен MP3 или WAV", &[]))?;
        let id = format!("{:x}", Sha1::digest(bytes));
        std::fs::create_dir_all(&self.store).map_err(io)?;
        let to = self.store.join(format!("{id}.{kind}"));
        if !to.exists() {
            crate::file_tx::write_into(bytes, &to, None).map_err(io)?;
        }
        Ok(id)
    }

    /// What the window shows: the songs on now and where they play.
    pub fn state(lib: &Library) -> Value {
        match record_of(lib) {
            Some(r) => {
                let g = &r["generated"];
                json!({
                    "songs": g["songs"], "menu": g["menu"], "game": g["game"], "installed": true,
                    "enabled": r.get("enabled") != Some(&Value::Bool(false)),
                })
            }
            None => {
                json!({ "songs": [], "menu": true, "game": true, "installed": false, "enabled": false })
            }
        }
    }

    /// The pak: the songs compiled, and every music pack's events playing them; `fights` and
    /// `roshan` say which of `ids` are theirs.
    #[allow(clippy::too_many_arguments)]
    fn build(
        &self,
        ids: &[String],
        fights: &[String],
        roshan: &[String],
        places: Places,
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Vec<u8>, String> {
        let game = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        let ix =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        let songs: Vec<String> = ids.iter().map(|i| song_path(i)).collect();
        let calm: Vec<String> =
            ids.iter().filter(|i| !fights.contains(i) && !roshan.contains(i)).map(|i| song_path(i)).collect();
        let fought: Vec<String> = fights.iter().map(|i| song_path(i)).collect();
        let boss: Vec<String> = roshan.iter().map(|i| song_path(i)).collect();
        let plan = Plan { calm: &calm, fights: &fought, roshan: &boss, menu: places.menu, game: places.game };
        let mut files = Vec::new();
        for id in ids {
            let (path, ext) = self.kept(id).ok_or_else(|| t("Файла песни больше нет: добавь её заново", &[]))?;
            let src = song_path(id);
            files.push(SourceFile {
                path: format!("{}.{ext}", src.trim_end_matches(".vsnd")),
                data: std::fs::read(path).map_err(io)?,
            });
        }
        let mut want: Vec<String> = songs.iter().map(|s| format!("{s}_c")).collect();
        for ev in pack_events(ix.paths()) {
            let Some(raw) = ix.read(&ev).ok().flatten() else { continue };
            let kv = crate::resource::data_block(&raw)
                .map_err(|e| e.to_string())
                .and_then(|d| crate::kv3::read(d).map_err(|e| e.to_string()));
            let (text, n) = match kv.and_then(|kv| music_events(&kv, &plan)) {
                Ok(x) => x,
                Err(e) => {
                    log(format!("music: {ev} left as it is: {e}"));
                    continue;
                }
            };
            if n == 0 {
                continue;
            }
            files.push(SourceFile { path: ev.trim_end_matches("_c").to_string(), data: text.into_bytes() });
            want.push(ev);
        }
        let job = CompileJob { compile: files.iter().map(|f| f.path.clone()).collect(), id: "own_music".into(), files };
        let out = compile(&job)?;
        let kept: Vec<Entry> = out.into_iter().filter(|e| want.contains(&e.path())).collect();
        if kept.len() != want.len() {
            log(format!("music: compiled {} of {} files", kept.len(), want.len()));
            return Err(t("resourcecompiler.exe не собрал музыку", &[]));
        }
        log(format!("music: {} song(s), {} pack(s)", ids.len(), want.len() - ids.len()));
        Ok(crate::vpk::build(&kept))
    }

    /// `songs` ([{ id, name, seconds, role }] in the window's order) put on: role "fight" in the
    /// fights, "roshan" in Roshan's fight, the rest ("calm") where `places` says. Nothing left to play takes the record off.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        songs: &[Value],
        places: Places,
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let mut list: Vec<Value> = Vec::new();
        for s in songs.iter().take(MAX_SONGS) {
            let id = s["id"].as_str().unwrap_or_default();
            if !id_ok(id) || list.iter().any(|x| x["id"] == id) {
                continue;
            }
            let name = crate::js::slice_utf16(s["name"].as_str().unwrap_or(id), 120);
            let role = match s["role"].as_str() {
                Some("fight") => "fight",
                Some("roshan") => "roshan",
                _ => "calm",
            };
            list.push(json!({ "id": id, "name": name, "seconds": s.get("seconds").cloned().unwrap_or(Value::Null), "role": role }));
        }
        let of_role = |r: &str| -> Vec<String> {
            list.iter().filter(|s| s["role"] == r).map(|s| crate::js::string(&s["id"])).collect()
        };
        let (fights, roshan) = (of_role("fight"), of_role("roshan"));
        let calm_plays = list.len() > fights.len() + roshan.len() && (places.menu || places.game);
        let old = record_of(lib);
        if !calm_plays && fights.is_empty() && roshan.is_empty() {
            if let Some(old) = old {
                inst.remove(&files_of(&old), old["id"].as_str(), true)?;
                lib.remove_record(&old["id"], None).map_err(io)?;
            }
            log("music: back to the game's".into());
            return Ok(Value::Null);
        }
        let ids: Vec<String> = list.iter().map(|s| s["id"].as_str().unwrap_or_default().to_string()).collect();
        let vpk = self.build(&ids, &fights, &roshan, places, compile, log)?;
        let name = t("Своя музыка: {0}", &[json!(list.len())]);
        let generated = json!({ "music": true, "songs": list, "menu": places.menu, "game": places.game });
        let rec = if let Some(old) = old {
            let files = swap_pak(inst, &old, &vpk, false)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": generated, "enabled": true,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null)
        } else {
            let files = write_pak(inst, &vpk)?;
            let new = json!({
                "name": name, "categoryId": "backgrounds", "styleLabel": null, "fileRef": null, "preview": null,
                "files": files_json(&files),
            });
            let made = lib.add(&new, None).map_err(io)?;
            lib.update(&made["id"], &json!({ "generated": generated }), None).map_err(io)?.unwrap_or(Value::Null)
        };
        self.tidy(&ids);
        Ok(rec)
    }

    /// Songs no record uses any more.
    fn tidy(&self, keep: &[String]) {
        for e in crate::js::read_dir(&self.store).unwrap_or_default() {
            let name = e.file_name().to_string_lossy().into_owned();
            let stem = name.split('.').next().unwrap_or_default();
            if !keep.iter().any(|k| k == stem) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_song_is_kept_once_by_its_bytes_and_only_an_mp3_or_a_wav() {
        let dir = std::env::temp_dir().join(format!("d2mm-music-{}", std::process::id()));
        let svc = OwnMusic::new(&dir, None);
        let mp3 = b"ID3\x04\x00\x00\x00\x00\x00\x00rest of the song".to_vec();
        let a = svc.keep(&mp3).unwrap();
        assert_eq!(a, svc.keep(&mp3).unwrap());
        assert!(id_ok(&a));
        assert!(svc.kept(&a).is_some_and(|(_, e)| e == "mp3"));
        assert!(svc.keep(b"OggS\x00\x02 not taken").is_err());
        svc.tidy(&[]);
        assert!(svc.kept(&a).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
