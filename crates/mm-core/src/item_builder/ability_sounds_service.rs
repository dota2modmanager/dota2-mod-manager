//! The window's half of a sound of the user's own on a hero's sound event
//! (issue #423; the events themselves are ability_sounds.rs). One
//! record in My mods per hero, since a hero's sounds are one events file and two paks of it would
//! hide each other; each sound can be taken off on its own, and taking off the last removes the
//! record.
//!
//! The user's WAVs are kept in userData/ability-sounds by their sha1, so building the hero again
//! needs nothing but what the app has. A build runs Valve's compiler (resource_compiler.rs), which
//! is the caller's `Compile`: the shell runs these calls off the main thread.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};

use crate::ability_sounds::{
    edited_events, event_files, events_file, hero_events, heroes_with_sounds, sound_hero, sound_path, sound_plan,
    wav_at_volume, wav_problem, SoundEdit,
};
use crate::generated_pak::{files_json, files_of, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::resource_compiler::{CompileJob, SourceFile};
use crate::vpk::{Entry, Index};

/// How the paks are built: 2 puts a sound in place of the game's own file and writes the events
/// file only when it must. A record without it is built again at the next update.
pub const RULE: u64 = 2;

/// A compile of the caller's: the files it made, at their paths.
pub type Compile<'a> = &'a mut dyn FnMut(&CompileJob) -> Result<Vec<Entry>, String>;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// The service the sounds:* channels call.
pub struct AbilitySoundsService {
    pub game: Option<PathBuf>,
    pub store: PathBuf,
}

impl AbilitySoundsService {
    pub fn new(game: Option<PathBuf>, user_data: &Path) -> Self {
        AbilitySoundsService { game, store: user_data.join("ability-sounds") }
    }

    fn pak01(&self) -> Result<Arc<Index>, String> {
        let g = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        crate::vpk_shared::shared_index(&g.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())
    }

    fn events_of(&self, hero: &str) -> Result<crate::kv3::Block, String> {
        let raw = self
            .pak01()?
            .read(&events_file(hero))
            .map_err(|e| e.to_string())?
            .ok_or_else(|| t("У этого героя нет файла звуков", &[]))?;
        let data = crate::resource::data_block(&raw).map_err(|e| e.to_string())?;
        crate::kv3::read(data).map_err(|e| e.to_string())
    }

    fn record_of(lib: &Library, hero: &str) -> Option<Value> {
        lib.list().iter().find(|r| r["generated"]["sounds"].as_str() == Some(hero)).cloned()
    }

    fn edits_of(lib: &Library, hero: &str) -> Vec<SoundEdit> {
        Self::record_of(lib, hero)
            .and_then(|r| serde_json::from_value(r["generated"]["edits"].clone()).ok())
            .unwrap_or_default()
    }

    /// The hero's pak: the user's sounds compiled in place of the game's own files, and the events
    /// file only for what has no file to take (ability_sounds.rs `SoundPlan`).
    fn build(
        &self,
        hero: &str,
        edits: &[SoundEdit],
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Vec<u8>, String> {
        let kv = self.events_of(hero)?;
        let plan = sound_plan(&event_files(&kv), edits);
        if let Some(first) = plan.gone.first() {
            log(format!("sounds: {hero}: {} events are not in the game any more, first {first}", plan.gone.len()));
        }
        if let Some(first) = plan.shared.first() {
            log(format!(
                "sounds: {hero}: {} game files wanted by two sounds, the later kept, first {first}",
                plan.shared.len()
            ));
        }
        let wav = |sound: &str| std::fs::read(self.store.join(format!("{sound}.wav"))).map_err(io);
        let mut files = Vec::new();
        let mut want: Vec<String> = Vec::new();
        for (stem, sound, volume) in &plan.files {
            files.push(SourceFile { path: format!("{stem}.wav"), data: wav_at_volume(&wav(sound)?, *volume) });
            want.push(format!("{stem}.vsnd_c"));
        }
        if !plan.events.is_empty() {
            let (text, _) = edited_events(&kv, hero, &plan.events)?;
            let mut ours: Vec<&str> = Vec::new();
            for e in &plan.events {
                if !ours.contains(&e.sound.as_str()) {
                    ours.push(&e.sound);
                }
            }
            for sound in ours {
                let p = sound_path(hero, sound);
                let stem = p.strip_suffix(".vsnd").unwrap_or(&p).to_string();
                files.push(SourceFile { path: format!("{stem}.wav"), data: wav(sound)? });
                want.push(format!("{stem}.vsnd_c"));
            }
            let ev = events_file(hero);
            files.push(SourceFile { path: ev.strip_suffix("_c").unwrap_or(&ev).to_string(), data: text.into_bytes() });
            want.push(ev);
        }
        if files.is_empty() {
            return Err(t("У героя нет такого звука", &[]));
        }
        let id: String = format!("snd_{hero}").chars().take(64).collect();
        let job = CompileJob { compile: files.iter().map(|f| f.path.clone()).collect(), id, files };
        let out = compile(&job)?;
        let kept: Vec<Entry> = out.into_iter().filter(|e| want.contains(&e.path())).collect();
        if kept.len() != want.len() {
            return Err(t("resourcecompiler.exe не собрал звуки", &[]));
        }
        Ok(crate::vpk::build(&kept))
    }

    /// The hero built again with `edits`: in his record's slot, a new record, or none when empty.
    fn apply(
        &self,
        inst: &Installer,
        lib: &mut Library,
        hero: &str,
        edits: Vec<SoundEdit>,
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let old = Self::record_of(lib, hero);
        if edits.is_empty() {
            if let Some(old) = old {
                inst.remove(&files_of(&old), old["id"].as_str(), true)?;
                lib.remove_record(&old["id"], None).map_err(io)?;
            }
            return Ok(Value::Null);
        }
        let vpk = self.build(hero, &edits, compile, log)?;
        let name = t("Свои звуки: {0}", &[json!(crate::ability_sounds::sounds_label(hero))]);
        let generated = json!({ "sounds": hero, "edits": edits, "rule": RULE });
        if let Some(old) = old {
            let files = swap_pak(inst, &old, &vpk, false)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": generated, "enabled": true,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": name, "categoryId": "hero-sounds", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": generated }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// Every hero with an events file: the file's name, the hero's own id, and his name.
    pub fn heroes(&self) -> Result<Value, String> {
        let ix = self.pak01()?;
        let present: std::collections::HashSet<&str> = ix.paths().collect();
        // the game's own sounds first, then every hero
        let game = crate::ability_sounds::GAME_SOUNDS.iter().filter(|(_, file, _)| present.contains(file)).map(
            |(id, _, _)| json!({ "id": id, "name": crate::ability_sounds::sounds_label(id), "hero": "", "game": true }),
        );
        let heroes = heroes_with_sounds(ix.paths()).into_iter().map(|id| {
            let hero = sound_hero(&id);
            json!({ "id": id, "name": crate::hero_names::display_name(&hero), "hero": hero })
        });
        Ok(json!(game.chain(heroes).collect::<Vec<_>>()))
    }

    /// A hero's events and the sounds of the user's on them.
    pub fn hero(&self, lib: &Library, hero: &str) -> Result<Value, String> {
        let events = hero_events(&self.events_of(hero)?);
        Ok(json!({
            "hero": hero, "events": events, "edits": Self::edits_of(lib, hero),
            "recId": Self::record_of(lib, hero).map(|r| r["id"].clone()),
        }))
    }

    /// The user's sound on `event`, in place of one already there: (hero, event, mode, volume, the
    /// WAV, its label).
    pub fn add(
        &self,
        inst: &Installer,
        lib: &mut Library,
        (hero, event, mode, volume, wav, label): (&str, &str, &str, f64, &[u8], &str),
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        if let Some(why) = wav_problem(wav) {
            return Err(t("Этот звук не подходит: {0}", &[json!(why)]));
        }
        if !hero_events(&self.events_of(hero)?).iter().any(|e| e.name == event) {
            return Err(t("У героя нет такого звука", &[]));
        }
        let sound: String = <sha1::Sha1 as sha1::Digest>::digest(wav).iter().map(|b| format!("{b:02x}")).collect();
        std::fs::create_dir_all(&self.store).map_err(io)?;
        std::fs::write(self.store.join(format!("{sound}.wav")), wav).map_err(io)?;
        let mut edits: Vec<SoundEdit> = Self::edits_of(lib, hero).into_iter().filter(|e| e.event != event).collect();
        edits.push(SoundEdit {
            event: event.into(),
            mode: mode.into(),
            volume,
            sound: sound.clone(),
            name: crate::js::slice_utf16(label, 120),
        });
        let n = edits.len();
        let rec = self.apply(inst, lib, hero, edits, compile, log)?;
        log(format!("sounds: {hero}: {event} {mode} with {}, {n} in all", &sound[..8]));
        Ok(rec)
    }

    /// The user's sound off `event`; the last one off takes the record with it.
    pub fn remove(
        &self,
        inst: &Installer,
        lib: &mut Library,
        hero: &str,
        event: &str,
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let edits = Self::edits_of(lib, hero).into_iter().filter(|e| e.event != event).collect();
        self.apply(inst, lib, hero, edits, compile, log)
    }

    /// The records that hold a hero's own sounds, with the hero, that a Dota update leaves to build
    /// again: those among `ids` it reached, and any built before RULE, whose pak may still carry
    /// an events file.
    pub fn due(lib: &Library, ids: &[String]) -> Vec<(String, String)> {
        lib.list()
            .iter()
            .filter_map(|r| {
                let id = crate::js::string(r.get("id")?);
                let hero = r["generated"]["sounds"].as_str()?.to_string();
                (ids.contains(&id) || r["generated"]["rule"].as_u64() != Some(RULE)).then_some((id, hero))
            })
            .collect()
    }

    /// The hero built again from the game's current events file, after a Dota update.
    pub fn rebuild(
        &self,
        inst: &Installer,
        lib: &mut Library,
        hero: &str,
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let edits = Self::edits_of(lib, hero);
        self.apply(inst, lib, hero, edits, compile, log)
    }
}
