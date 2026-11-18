//! Guards which dota_<lang> folder the game mounts, and therefore where mods have to go. This is
//! the single most common cause of "my mods do nothing": the engine substitutes the AUDIO language
//! into its Game_AudioLanguage search path and mounts nothing at all for English, so a mod sitting
//! in a folder the game never mounts is invisible with no error anywhere.
//!
//! Replaces test/gamelang.test.ts. Every test here describes a whole machine in a throwaway folder
//! under the system temp directory, so the developer's own Steam is kept out of the picture: the
//! default Steam locations (Program Files) point at an empty folder while a test that reads Steam
//! runs, and those tests take one lock, since the environment is shared by the whole process.

use mm_core::gamelang::{self, LangDetection, ModFolder};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

static NEXT: AtomicUsize = AtomicUsize::new(0);
static ENV: Mutex<()> = Mutex::new(());

/// A folder of its own under the temp directory, removed when dropped.
struct Temp(PathBuf);

impl Temp {
    fn new(tag: &str) -> Temp {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("d2mm-{tag}-{}-{nanos}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// No Steam on this machine while the guard is held: both Program Files point at an empty folder.
struct NoSteam {
    _lock: MutexGuard<'static, ()>,
    empty: Temp,
    real: [Option<std::ffi::OsString>; 2],
}

const PF: [&str; 2] = ["ProgramFiles(x86)", "ProgramFiles"];

fn no_steam() -> NoSteam {
    let lock = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let empty = Temp::new("nosteam");
    let real = PF.map(std::env::var_os);
    for k in PF {
        std::env::set_var(k, &empty.0);
    }
    NoSteam { _lock: lock, empty, real }
}

impl NoSteam {
    fn point_x86_at(&self, dir: &Path) {
        std::env::set_var(PF[0], dir);
    }
    fn restore_x86(&self) {
        std::env::set_var(PF[0], &self.empty.0);
    }
}

impl Drop for NoSteam {
    fn drop(&mut self) {
        for (k, v) in PF.iter().zip(&self.real) {
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
    }
}

/// A throwaway <root>\steamapps\common\dota 2 beta\game tree.
struct FakeGame {
    _tmp: Temp,
    root: PathBuf,
    game: PathBuf,
}

#[derive(Default)]
struct Setup<'a> {
    boot: Option<&'a str>,
    steam_lang: Option<&'a str>,
    folders: &'a [(&'a str, &'a [&'a str])],
}

fn fake_game(s: Setup) -> FakeGame {
    let tmp = Temp::new("lang");
    let root = tmp.0.clone();
    let game = root.join("steamapps").join("common").join("dota 2 beta").join("game");
    fs::create_dir_all(game.join("dota").join("cfg")).unwrap();
    if let Some(boot) = s.boot {
        fs::write(game.join("dota").join("cfg").join("boot.vcfg"), boot).unwrap();
    }
    if let Some(lang) = s.steam_lang {
        fs::write(
            root.join("steamapps").join("appmanifest_570.acf"),
            format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"570\"\n\t\"MountedConfig\"\n\t{{\n\t\t\"language\"\t\t\"{lang}\"\n\t}}\n}}\n"
            ),
        )
        .unwrap();
    }
    for (name, files) in s.folders {
        fs::create_dir_all(game.join(name)).unwrap();
        for f in *files {
            fs::write(game.join(name).join(f), "").unwrap();
        }
    }
    FakeGame { _tmp: tmp, root, game }
}

fn boot_file(ui: &str, audio: &str) -> String {
    format!("\"boot\"\n{{\n\t\"UILanguage\"\t\t\"{ui}\"\n\t\"AudioLanguage\"\t\t\"{audio}\"\n}}\n")
}

fn some(s: &str) -> Option<String> {
    Some(s.to_string())
}

fn boot_text(game: &Path) -> String {
    fs::read_to_string(game.join("dota").join("cfg").join("boot.vcfg")).unwrap()
}

/// One Steam account: its 32-bit id, launch options, login timestamp and MostRecent flag.
struct User<'a> {
    id32: u64,
    launch_options: &'a str,
    timestamp: u64,
    most_recent: bool,
}

fn user(id32: u64, launch_options: &str, timestamp: u64) -> User<'_> {
    User { id32, launch_options, timestamp, most_recent: false }
}

/// A Steam root at `root`: accounts, their launch options, and who is logged in.
fn fake_steam(root: &Path, users: &[User]) {
    fs::create_dir_all(root.join("config")).unwrap();
    let blocks: Vec<String> = users
        .iter()
        .map(|u| {
            let id64 = u.id32 + 76561197960265728;
            let recent = if u.most_recent { "\n\t\t\"MostRecent\"\t\t\"1\"" } else { "" };
            let ts = if u.timestamp == 0 { 1 } else { u.timestamp };
            format!("\t\"{id64}\"\n\t{{\n\t\t\"Timestamp\"\t\t\"{ts}\"{recent}\n\t}}")
        })
        .collect();
    fs::write(root.join("config").join("loginusers.vdf"), format!("\"users\"\n{{\n{}\n}}\n", blocks.join("\n")))
        .unwrap();
    for u in users {
        let dir = root.join("userdata").join(u.id32.to_string()).join("config");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("localconfig.vdf"),
            format!(
                "\"UserLocalConfigStore\"\n{{\n\t\"Software\"\n\t{{\n\t\t\"Valve\"\n\t\t{{\n\t\t\t\"Steam\"\n\t\t\t{{\n\t\t\t\t\"apps\"\n\t\t\t\t{{\n\t\t\t\t\t\"570\"\n\t\t\t\t\t{{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"{}\"\n\t\t\t\t\t}}\n\t\t\t\t}}\n\t\t\t}}\n\t\t}}\n\t}}\n}}\n",
                u.launch_options
            ),
        )
        .unwrap();
    }
}

fn in_folder(game: &Path, suffix: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(game.join(format!("dota_{suffix}")))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn folder(suffix: &str, followed: bool, locked: Option<bool>) -> ModFolder {
    ModFolder { suffix: suffix.to_string(), followed, locked }
}

// ---------- what the game wrote ----------

#[test]
fn the_two_language_settings_are_read_separately() {
    let g = fake_game(Setup { boot: Some(&boot_file("english", "russian")), ..Default::default() });
    // English text, Russian voice: the voice language is the one that decides the mod folder
    assert_eq!(gamelang::boot_languages(Some(&g.game)), Some((some("english"), some("russian"))));
}

#[test]
fn audio_falls_back_to_the_ui_language_when_the_game_recorded_only_one() {
    let g = fake_game(Setup { boot: Some("\"boot\"\n{\n\t\"UILanguage\"\t\t\"german\"\n}\n"), ..Default::default() });
    assert_eq!(gamelang::boot_languages(Some(&g.game)), Some((some("german"), some("german"))));
}

#[test]
fn a_game_that_has_never_booted_reports_no_languages_rather_than_a_guess() {
    let g = fake_game(Setup::default());
    assert_eq!(gamelang::boot_languages(Some(&g.game)), None);
    assert_eq!(gamelang::boot_languages(None), None);
}

#[test]
fn steams_own_language_is_the_fallback_before_the_game_has_ever_run() {
    let _env = no_steam();
    let g = fake_game(Setup { steam_lang: Some("russian"), ..Default::default() });
    assert_eq!(gamelang::steam_language(Some(&g.game)), some("russian"));
    assert_eq!(
        gamelang::detect_lang_suffix(Some(&g.game)),
        LangDetection { suffix: some("russian"), source: Some("steam"), ui_language: None, audio: some("russian") }
    );
}

#[test]
fn the_games_own_setting_wins_over_steams() {
    let _env = no_steam();
    let g = fake_game(Setup {
        boot: Some(&boot_file("english", "russian")),
        steam_lang: Some("schinese"),
        ..Default::default()
    });
    let got = gamelang::detect_lang_suffix(Some(&g.game));
    assert_eq!(got.suffix, some("russian"));
    assert_eq!(got.source, Some("boot"));
    assert_eq!(got.ui_language, some("english"));
}

#[test]
fn an_audio_language_dota_does_not_ship_is_ignored_in_favour_of_steam() {
    let _env = no_steam();
    let g = fake_game(Setup {
        boot: Some(&boot_file("english", "klingon")),
        steam_lang: Some("russian"),
        ..Default::default()
    });
    let got = gamelang::detect_lang_suffix(Some(&g.game));
    assert_eq!(got.suffix, some("russian"));
    assert_eq!(got.source, Some("steam"));
}

#[test]
fn with_nothing_official_to_go_on_the_suffix_is_none_not_a_default() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("klingon", "klingon")), ..Default::default() });
    assert_eq!(
        gamelang::detect_lang_suffix(Some(&g.game)),
        LangDetection {
            suffix: None,
            source: None,
            ui_language: some("klingon"),
            // unrecognised, but still reported: this is the value the engine builds its mount
            // path from, and another mod manager setting it is how mods end up somewhere we do not look
            audio: some("klingon"),
        }
    );
}

// ---------- which folder a language gets ----------

#[test]
fn every_voice_language_gets_the_folder_the_engine_will_actually_mount() {
    assert_eq!(gamelang::folder_for(Some("russian")), "russian");
    assert_eq!(gamelang::folder_for(Some("koreana")), "koreana");
    assert_eq!(gamelang::folder_for(Some("schinese")), "schinese");
}

#[test]
fn english_borrows_the_russian_folder_because_it_has_none_of_its_own() {
    // English speech ships inside dota/pak01, so Valve makes no dota_english and its gameinfo
    // mounts no language path for English at all
    assert_eq!(gamelang::folder_for(Some("english")), "russian");
    assert!(!gamelang::MOD_FOLDERS.contains(&"english"));
}

#[test]
fn an_unknown_audio_language_falls_back_rather_than_inventing_a_folder() {
    assert_eq!(gamelang::folder_for(Some("klingon")), "russian");
    // TS tested null and undefined separately; Rust has one None
    assert_eq!(gamelang::folder_for(None), "russian");
}

#[test]
fn the_voice_languages_are_the_four_dota_records_not_the_text_languages() {
    let mut voices = gamelang::VOICE_LANGUAGES.to_vec();
    voices.sort();
    assert_eq!(voices, ["english", "koreana", "russian", "schinese"]);
    assert!(!gamelang::VOICE_LANGUAGES.contains(&"german"));
}

// ---------- what is on disk ----------

#[test]
fn valves_voice_paks_and_our_mod_paks_are_told_apart() {
    let g = fake_game(Setup {
        // pak01_* is the voice-over; everything else in here is a mod
        folders: &[("dota_russian", &["pak01_dir.vpk", "pak01_000.vpk", "pak10_dir.vpk", "pak11_dir.vpk.off"])],
        ..Default::default()
    });
    let folders = gamelang::lang_folders(Some(&g.game));
    assert_eq!(folders.len(), 1);
    let ru = &folders[0];
    assert_eq!(ru.suffix, "russian");
    assert!(ru.official);
    assert!(ru.valve_content, "pak01 present means the voice pack is installed");
    assert_eq!(ru.mod_files, 2, "a disabled mod still counts as ours");
}

#[test]
fn a_language_folder_holding_only_mods_is_not_reported_as_valve_content() {
    let g = fake_game(Setup { folders: &[("dota_russian", &["pak10_dir.vpk"])], ..Default::default() });
    let folders = gamelang::lang_folders(Some(&g.game));
    assert!(!folders[0].valve_content);
    assert_eq!(folders[0].mod_files, 1);
}

#[test]
fn addons_low_violence_and_core_are_not_language_layers() {
    let g = fake_game(Setup {
        folders: &[("dota_addons", &[]), ("dota_lv", &["pak01_dir.vpk"]), ("dota_core", &[]), ("dota_russian", &[])],
        ..Default::default()
    });
    let suffixes: Vec<String> = gamelang::lang_folders(Some(&g.game)).into_iter().map(|f| f.suffix).collect();
    assert_eq!(suffixes, ["russian"]);
}

#[test]
fn a_made_up_language_folder_is_reported_but_flagged_as_unofficial() {
    let g = fake_game(Setup { folders: &[("dota_123", &["pak10_dir.vpk"])], ..Default::default() });
    let folders = gamelang::lang_folders(Some(&g.game));
    assert_eq!(folders[0].suffix, "123");
    assert!(!folders[0].official, "the engine will not mount this one");
}

#[test]
fn no_game_folder_has_no_language_folders() {
    assert!(gamelang::lang_folders(None).is_empty());
}

#[test]
fn the_voice_pack_is_only_considered_installed_when_its_paks_are_on_disk() {
    let g = fake_game(Setup {
        folders: &[("dota_russian", &["pak01_dir.vpk"]), ("dota_german", &["pak10_dir.vpk"])],
        ..Default::default()
    });
    // serving mods from a Russian folder while voices stay English: mount the folder, keep pak01 out
    assert!(gamelang::voice_installed(&g.game, "russian"));
    assert!(!gamelang::voice_installed(&g.game, "german"));
    assert!(!gamelang::voice_installed(&g.game, "koreana"));
}

// ---------- writing boot.vcfg ----------

#[test]
fn writing_the_languages_patches_the_file_and_leaves_other_keys_alone() {
    let g = fake_game(Setup {
        boot: Some(
            "\"boot\"\n{\n\t\"UILanguage\"\t\t\"english\"\n\t\"AudioLanguage\"\t\t\"english\"\n\t\"SomethingElse\"\t\t\"keep me\"\n}\n",
        ),
        ..Default::default()
    });
    gamelang::write_boot_languages(&g.game, Some("english"), Some("russian")).unwrap();
    assert_eq!(gamelang::boot_languages(Some(&g.game)), Some((some("english"), some("russian"))));
    assert!(boot_text(&g.game).contains("\"keep me\""), "unrelated settings survive");
}

#[test]
fn writing_the_languages_creates_the_file_when_the_game_never_wrote_one() {
    let g = fake_game(Setup::default());
    gamelang::write_boot_languages(&g.game, Some("ru"), Some("russian")).unwrap();
    assert_eq!(gamelang::boot_languages(Some(&g.game)), Some((some("ru"), some("russian"))));
}

// The app sets the audio language and nothing else: the folder it names is where mods have to
// live, while the language somebody reads the game in was their choice long before this.
#[test]
fn the_audio_language_can_be_set_without_touching_the_text_one() {
    let g = fake_game(Setup {
        boot: Some("\"boot\"\n{\n\t\"UILanguage\"\t\t\"koreana\"\n\t\"AudioLanguage\"\t\t\"english\"\n}\n"),
        ..Default::default()
    });
    gamelang::write_boot_languages(&g.game, None, Some("russian")).unwrap();
    assert_eq!(gamelang::boot_languages(Some(&g.game)), Some((some("koreana"), some("russian"))));
}

#[test]
fn setting_only_the_audio_language_on_a_game_that_never_booted_writes_just_that() {
    let g = fake_game(Setup::default());
    gamelang::write_boot_languages(&g.game, None, Some("russian")).unwrap();
    assert!(!boot_text(&g.game).to_lowercase().contains("uilanguage"), "no text language is invented for the user");
    assert_eq!(gamelang::boot_languages(Some(&g.game)), Some((None, some("russian"))));
}

// ---------- the folder a mod goes to ----------

#[test]
fn creating_a_mod_folder_mirrors_valve_and_never_overwrites_an_existing_gameinfo() {
    let g = fake_game(Setup::default());
    let dir = gamelang::ensure_lang_folder(&g.game, "russian").unwrap();
    let gi = dir.join("gameinfo.gi");
    assert!(gi.exists());
    let written = fs::read_to_string(&gi).unwrap();
    let has = |pat: &str| regex::Regex::new(pat).unwrap().is_match(&written);
    assert!(has(r"LayeredOnMod\s+dota"));
    assert!(has(r"Game\s+dota_russian"));
    assert!(has(r"Mod\s+dota_russian"));

    fs::write(&gi, "hand edited").unwrap();
    gamelang::ensure_lang_folder(&g.game, "russian").unwrap();
    assert_eq!(fs::read_to_string(&gi).unwrap(), "hand edited", "Valve's own file is left as found");
}

#[test]
fn a_language_folder_that_already_exists_is_not_written_into() {
    // dota_dutch is Minify's doing and mounts without anything from us
    let g = fake_game(Setup { folders: &[("dota_dutch", &["pak66_dir.vpk"])], ..Default::default() });
    gamelang::ensure_lang_folder(&g.game, "dutch").unwrap();
    assert!(!g.game.join("dota_dutch").join("gameinfo.gi").exists());

    // one we create ourselves still gets the stub Valve's own folders carry
    gamelang::ensure_lang_folder(&g.game, "koreana").unwrap();
    assert!(g.game.join("dota_koreana").join("gameinfo.gi").exists());
}

#[test]
fn a_mod_folder_that_cannot_be_made_is_an_error_not_a_silent_success() {
    // stands in for the TS test that made the gameinfo write throw EACCES: Rust has no hook into
    // fs, so the failure here is a game path that is a file, where no folder can be made
    let tmp = Temp::new("lang-err");
    let game = tmp.0.join("game");
    fs::write(&game, "not a folder").unwrap();
    assert!(gamelang::ensure_lang_folder(&game, "russian").is_err());
}

// ---------- launch options ----------

#[test]
fn a_language_launch_option_is_what_decides_the_folder_over_anything_the_game_wrote() {
    // how Minify gets dota_dutch mounted: the parameter locks both language settings
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g.root, &[user(111, "-novid -language dutch", 5)]);
    let got = gamelang::detect_lang_suffix(Some(&g.game));
    assert_eq!(got.audio, some("dutch"));
    assert_eq!(got.source, Some("launch"));
    assert_eq!(got.suffix, None, "Dutch has no voice pack, so it is not one of the four");
}

/// Exactly what Minify v1.14rc7 leaves behind, escapes and all: `cmd /c "<its exe>" prelaunch &&`
/// in front, written back by python-vdf, which escapes both the quotes and the backslashes.
const RC7_OPTIONS: &str = r#"cmd /c \"C:\\Users\\me\\Desktop\\Dota2-Minify\\Dota2-Minify.exe\" prelaunch && %command% -novid -language dutch"#;

#[test]
fn a_launch_option_survives_another_program_putting_a_quoted_path_in_front_of_it() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g.root, &[user(111, RC7_OPTIONS, 5)]);
    assert_eq!(gamelang::launch_language(Some(&g.game)), some("dutch"));
    assert_eq!(gamelang::detect_lang_suffix(Some(&g.game)).source, Some("launch"));
}

#[test]
fn the_whole_launch_line_comes_back_unescaped_so_it_can_be_recognised() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g.root, &[user(111, RC7_OPTIONS, 5)]);
    let raw = gamelang::launch_options(Some(&g.game)).unwrap_or_default();
    assert!(
        raw.starts_with(r#"cmd /c "C:\Users\me\Desktop\Dota2-Minify\Dota2-Minify.exe" prelaunch &&"#),
        "unescaped start, got {raw:?}"
    );
    assert!(raw.ends_with("-novid -language dutch"), "and nothing after the quotes is lost");
}

#[test]
fn plain_options_still_read_the_way_they_always_did() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g.root, &[user(111, "-novid -console -language schinese", 5)]);
    assert_eq!(gamelang::launch_options(Some(&g.game)), some("-novid -console -language schinese"));
    assert_eq!(gamelang::launch_language(Some(&g.game)), some("schinese"));
}

#[test]
fn the_account_that_is_logged_in_is_the_one_whose_launch_options_count() {
    // an option belonging to a sibling account would move mods for somebody who never set it
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g.root, &[user(111, "-novid -console", 900), user(222, "-language dutch", 100)]);
    assert_eq!(gamelang::launch_language(Some(&g.game)), None);
    assert_eq!(gamelang::detect_lang_suffix(Some(&g.game)).audio, some("russian"));
}

#[test]
fn most_recent_wins_over_the_newest_timestamp_when_steam_writes_it() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    let recent = User { most_recent: true, ..user(222, "-language schinese", 1) };
    fake_steam(&g.root, &[user(111, "-language koreana", 900), recent]);
    assert_eq!(gamelang::launch_language(Some(&g.game)), some("schinese"));
}

#[test]
fn with_nobody_identifiable_one_shared_answer_is_used_and_a_disagreement_is_not() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g.root, &[user(111, "-language dutch", 5), user(222, "-language dutch", 6)]);
    fs::remove_file(g.root.join("config").join("loginusers.vdf")).unwrap();
    assert_eq!(gamelang::launch_language(Some(&g.game)), some("dutch"));

    let g2 = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g2.root, &[user(111, "-language dutch", 5), user(222, "-language koreana", 6)]);
    fs::remove_file(g2.root.join("config").join("loginusers.vdf")).unwrap();
    assert_eq!(gamelang::launch_language(Some(&g2.game)), None, "two answers is not an answer");
}

#[test]
fn no_steam_layout_at_all_is_not_an_override() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    assert_eq!(gamelang::launch_language(Some(&g.game)), None);
    assert_eq!(gamelang::launch_options(Some(&g.game)), None);
}

#[test]
fn an_account_beside_the_library_that_sets_no_language_ends_the_search_there() {
    // tools/dev/sandbox.js depends on this: with no account of its own, the lookup went on to
    // Program Files\Steam and found the developer's own -language dutch
    let env = no_steam();
    let base = Temp::new("pf");
    let defaults = User { most_recent: true, ..user(222, "-language dutch", 0) };
    fake_steam(&base.0.join("Steam"), &[defaults]);
    env.point_x86_at(&base.0);

    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    if cfg!(windows) {
        assert_eq!(
            gamelang::launch_language(Some(&g.game)),
            some("dutch"),
            "with no account of its own the library borrows the default install"
        );
    }
    fake_steam(&g.root, &[User { most_recent: true, ..user(111, "", 0) }]);
    assert_eq!(gamelang::launch_language(Some(&g.game)), None);
    env.restore_x86();
}

#[test]
fn a_launch_option_naming_a_real_language_decides_the_folder_and_the_app_follows_it() {
    // `-language X` locks both language settings and the engine builds its content path from it
    assert_eq!(gamelang::mod_folder_for(Some("dutch"), Some("russian"), None), folder("dutch", true, None));
    assert_eq!(gamelang::mod_folder_for(Some("German"), Some("russian"), None), folder("german", true, None));
}

#[test]
fn without_a_launch_option_the_voice_language_decides_as_before() {
    assert_eq!(gamelang::mod_folder_for(None, Some("russian"), None), folder("russian", false, None));
    assert_eq!(gamelang::mod_folder_for(None, Some("koreana"), None), folder("koreana", false, None));
    // a folder kept in Settings wins over the launch option; one the game cannot mount by voice is no folder to keep
    assert_eq!(
        gamelang::mod_folder_for(Some("english"), Some("russian"), Some("russian")),
        folder("russian", false, Some(true))
    );
    assert_eq!(
        gamelang::mod_folder_for(Some("english"), Some("russian"), Some("dutch")),
        folder("english", true, None)
    );
    // English has no folder of its own and borrows the Russian one
    assert_eq!(gamelang::mod_folder_for(None, Some("english"), None), folder("russian", false, None));
    // an empty launch option is no launch option
    assert_eq!(gamelang::mod_folder_for(Some(""), Some("koreana"), None), folder("koreana", false, None));
}

#[test]
fn a_launch_option_dota_would_not_accept_is_not_followed_anywhere() {
    // the engine mounts a folder only for a language it knows
    assert_eq!(gamelang::mod_folder_for(Some("klingon"), Some("russian"), None), folder("russian", false, None));
    assert_eq!(gamelang::mod_folder_for(Some("minify"), Some("russian"), None), folder("russian", false, None));
}

#[test]
fn a_mod_folder_serialises_without_locked_unless_a_lock_decided_it() {
    // the TS deepEqual shapes: { suffix, followed } with no `locked` key unless locked
    let free = serde_json::to_value(gamelang::mod_folder_for(Some("dutch"), None, None)).unwrap();
    assert_eq!(free, serde_json::json!({ "suffix": "dutch", "followed": true }));
    let kept = serde_json::to_value(gamelang::mod_folder_for(None, None, Some("koreana"))).unwrap();
    assert_eq!(kept, serde_json::json!({ "suffix": "koreana", "followed": false, "locked": true }));
}

// ---------- moving mods when the mounted folder changes ----------
// Runs at startup, unasked, over files the user installed: a mod left behind is invisible, a mod
// written over is gone, and a file carried off that was never ours belongs to Valve or to another program.

#[test]
fn mods_follow_the_folder_the_game_mounts_and_the_games_own_files_stay_where_they_are() {
    let g = fake_game(Setup {
        folders: &[("dota_russian", &["pak10_dir.vpk", "pak11_dir.vpk", "pak01_000.vpk", "gameinfo.gi"])],
        ..Default::default()
    });
    let moved = gamelang::move_lang_folder(Some(&g.game), Some("russian"), Some("koreana"));
    assert_eq!(moved, 2, "the count is the mods, not everything in the folder");
    let koreana: Vec<String> = in_folder(&g.game, "koreana").into_iter().filter(|f| f != "gameinfo.gi").collect();
    assert_eq!(koreana, ["pak10_dir.vpk", "pak11_dir.vpk"]);
    assert_eq!(
        in_folder(&g.game, "russian"),
        ["gameinfo.gi", "pak01_000.vpk"],
        "Valve's voice pak or the layer definition was carried off"
    );
}

#[test]
fn another_programs_mods_are_left_where_that_program_put_them() {
    // Minify writes pak65 to pak67 into whichever language folder it is set to
    let g = fake_game(Setup {
        folders: &[("dota_russian", &["pak10_dir.vpk", "pak66_dir.vpk", "pak66_000.vpk"])],
        ..Default::default()
    });
    let moved = gamelang::move_lang_folder(Some(&g.game), Some("russian"), Some("koreana"));
    assert_eq!(moved, 1);
    assert_eq!(in_folder(&g.game, "russian"), ["pak66_000.vpk", "pak66_dir.vpk"]);
}

#[test]
fn a_mod_already_in_the_new_folder_is_not_written_over_by_a_leftover() {
    // the one in the destination is what the game mounts now; overwriting loses the live one
    let g = fake_game(Setup {
        folders: &[("dota_russian", &["pak10_dir.vpk"]), ("dota_koreana", &["pak10_dir.vpk"])],
        ..Default::default()
    });
    fs::write(g.game.join("dota_koreana").join("pak10_dir.vpk"), "the mod in use").unwrap();
    fs::write(g.game.join("dota_russian").join("pak10_dir.vpk"), "the leftover").unwrap();

    let moved = gamelang::move_lang_folder(Some(&g.game), Some("russian"), Some("koreana"));
    assert_eq!(moved, 0);
    assert_eq!(fs::read_to_string(g.game.join("dota_koreana").join("pak10_dir.vpk")).unwrap(), "the mod in use");
    assert!(g.game.join("dota_russian").join("pak10_dir.vpk").exists(), "the leftover was deleted instead");
}

#[test]
fn an_emptied_folder_goes_away_one_that_still_holds_something_stays() {
    let g = fake_game(Setup { folders: &[("dota_russian", &["pak10_dir.vpk"])], ..Default::default() });
    assert_eq!(gamelang::move_lang_folder(Some(&g.game), Some("russian"), Some("koreana")), 1);
    assert!(!g.game.join("dota_russian").exists());

    let other =
        fake_game(Setup { folders: &[("dota_schinese", &["pak10_dir.vpk", "pak01_dir.vpk"])], ..Default::default() });
    assert_eq!(gamelang::move_lang_folder(Some(&other.game), Some("schinese"), Some("koreana")), 1);
    assert_eq!(in_folder(&other.game, "schinese"), ["pak01_dir.vpk"], "a folder with Valve's files in it was removed");
}

#[test]
fn a_move_with_nowhere_to_go_moves_nothing() {
    let g = fake_game(Setup { folders: &[("dota_russian", &["pak10_dir.vpk"])], ..Default::default() });
    let game = Some(g.game.as_path());
    assert_eq!(gamelang::move_lang_folder(game, Some("russian"), Some("russian")), 0, "a folder was moved onto itself");
    assert_eq!(gamelang::move_lang_folder(game, Some(""), Some("koreana")), 0);
    assert_eq!(gamelang::move_lang_folder(game, None, Some("koreana")), 0);
    assert_eq!(gamelang::move_lang_folder(game, Some("russian"), None), 0);
    assert_eq!(gamelang::move_lang_folder(None, Some("russian"), Some("koreana")), 0);
    assert_eq!(gamelang::move_lang_folder(game, Some("schinese"), Some("koreana")), 0, "a folder that is not there");
    assert_eq!(in_folder(&g.game, "russian"), ["pak10_dir.vpk"], "the folder was touched anyway");
    assert!(!g.game.join("dota_koreana").exists(), "a destination was made for nothing");

    // the same folder twice with nothing in it: without the guard the loop moves nothing, finds
    // the folder empty and removes the folder the game is mounting
    let empty = fake_game(Setup { folders: &[("dota_russian", &[])], ..Default::default() });
    assert_eq!(gamelang::move_lang_folder(Some(&empty.game), Some("russian"), Some("russian")), 0);
    assert!(empty.game.join("dota_russian").exists(), "the folder the game mounts was removed");
}

// ---------- the account folder ----------

#[test]
fn the_account_folder_for_hero_grids_is_the_logged_in_account_or_the_one_that_has_played_dota() {
    let _env = no_steam();
    let g = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    fake_steam(&g.root, &[user(111, "", 900), user(222, "", 100)]);
    assert_eq!(gamelang::steam_account_dir(Some(&g.game)), Some(g.root.join("userdata").join("111")));

    fs::remove_file(g.root.join("config").join("loginusers.vdf")).unwrap();
    assert_eq!(gamelang::steam_account_dir(Some(&g.game)), None, "two accounts and nobody logged in is not an answer");
    fs::create_dir_all(g.root.join("userdata").join("222").join("570")).unwrap();
    assert_eq!(
        gamelang::steam_account_dir(Some(&g.game)),
        Some(g.root.join("userdata").join("222")),
        "the one that has a Dota folder"
    );

    let bare = fake_game(Setup { boot: Some(&boot_file("russian", "russian")), ..Default::default() });
    assert_eq!(gamelang::steam_account_dir(Some(&bare.game)), None, "no userdata folder at all");
    fs::create_dir_all(bare.root.join("userdata").join("0")).unwrap();
    assert_eq!(gamelang::steam_account_dir(Some(&bare.game)), None, "userdata/0 is Steam signed out, not an account");
}
