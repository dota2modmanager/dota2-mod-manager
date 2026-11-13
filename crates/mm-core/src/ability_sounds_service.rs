//! The window's half of a sound of the user's own on a hero's sound event
//! (src/ability-sounds-service.ts, issue #423; the events themselves are ability_sounds.rs). One
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
    edited_events, events_file, hero_events, heroes_with_sounds, sound_hero, sound_path, wav_problem, SoundEdit,
};
use crate::generated_pak::{files_json, files_of, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::resource_compiler::{CompileJob, SourceFile};
use crate::vpk::{Entry, Index};

/// The longest sound the window takes: 30 s of 48 kHz stereo is 5.5 MB.
pub const MAX_WAV: usize = 8 * 1024 * 1024;

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

    /// The hero's pak: his events with the user's sounds, and the sounds, compiled.
    fn build(
        &self,
        hero: &str,
        edits: &[SoundEdit],
        compile: Compile,
        log: &mut dyn FnMut(String),
    ) -> Result<Vec<u8>, String> {
        let (text, gone) = edited_events(&self.events_of(hero)?, hero, edits)?;
        if let Some(first) = gone.first() {
            log(format!("sounds: {hero}: {} events are not in the game any more, first {first}", gone.len()));
        }
        let mut sounds: Vec<&str> = Vec::new();
        for e in edits {
            if !sounds.contains(&e.sound.as_str()) {
                sounds.push(&e.sound);
            }
        }
        let mut files = Vec::new();
        for sound in sounds {
            let p = sound_path(hero, sound);
            let p = p.strip_suffix(".vsnd").map(|s| format!("{s}.wav")).unwrap_or(p);
            files.push(SourceFile {
                path: p,
                data: std::fs::read(self.store.join(format!("{sound}.wav"))).map_err(io)?,
            });
        }
        let wavs: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
        let ev = events_file(hero);
        files.push(SourceFile { path: ev.strip_suffix("_c").unwrap_or(&ev).to_string(), data: text.into_bytes() });
        let id: String = format!("snd_{hero}").chars().take(64).collect();
        let job = CompileJob { compile: files.iter().map(|f| f.path.clone()).collect(), id, files };
        let out = compile(&job)?;
        let mut want: Vec<String> = vec![ev];
        for w in wavs {
            let c = format!("{}.vsnd_c", w.strip_suffix(".wav").unwrap_or(&w));
            if !want.contains(&c) {
                want.push(c);
            }
        }
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
        let name = t("Свои звуки: {0}", &[json!(crate::hero_names::display_name(&sound_hero(hero)))]);
        let generated = json!({ "sounds": hero, "edits": edits });
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
        Ok(json!(heroes_with_sounds(ix.paths())
            .into_iter()
            .map(|id| {
                let hero = sound_hero(&id);
                json!({ "id": id, "name": crate::hero_names::display_name(&hero), "hero": hero })
            })
            .collect::<Vec<_>>()))
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
