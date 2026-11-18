//! The environment a program the app starts should get on Linux, when the app runs from its
//! AppImage: the person's own, not the one the AppImage set up for its bundled libraries.
//!
//! The AppImage's AppRun and linuxdeploy's GTK hook point LD_LIBRARY_PATH, PATH, GIO_MODULE_DIR,
//! GTK_PATH, GDK_PIXBUF_MODULE_FILE, GSETTINGS_SCHEMA_DIR and the rest into the mounted image, and
//! put `$APPDIR/usr/share:/usr/share:` in front of XDG_DATA_DIRS. Every child inherits all of it.
//! xdg-open then picks the browser from /usr/share's list before the Flatpak exports, so on a
//! machine whose browser is a Flatpak (Linux Mint with Brave, 2026-11-18) "Sign in" and every link
//! opened some other browser, and host programs such as flatpak itself ran against the AppImage's
//! copies of glib and curl. The `open` crate leaves this to its callers on purpose.
//!
//! What is undone: each entry under APPDIR is dropped from any variable that names one, a
//! variable left with nothing is removed, and XDG_DATA_DIRS keeps the last copy of a repeated
//! folder, which is where the person's own list had it. Outside an AppImage nothing changes.

use std::process::Command;

/// The variables the AppImage runtime adds about itself.
const ABOUT_THE_IMAGE: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

fn under(entry: &str, appdir: &str) -> bool {
    entry == appdir || entry.strip_prefix(appdir).is_some_and(|rest| rest.starts_with('/'))
}

/// What to change in `vars` for a child to see the host's environment: a value to set, or None
/// to remove the variable. Empty when `vars` has no APPDIR.
pub fn changes<I, K, V>(vars: I) -> Vec<(String, Option<String>)>
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    let vars: Vec<(String, String)> = vars.into_iter().map(|(k, v)| (k.into(), v.into())).collect();
    let Some(appdir) = vars
        .iter()
        .find(|(k, _)| k == "APPDIR")
        .map(|(_, v)| v.trim_end_matches('/').to_string())
        .filter(|d| d.len() > 1)
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, value) in &vars {
        if ABOUT_THE_IMAGE.contains(&key.as_str()) {
            out.push((key.clone(), None));
            continue;
        }
        if !value.contains(appdir.as_str()) {
            continue;
        }
        let mut kept: Vec<&str> = value.split(':').filter(|e| !e.is_empty() && !under(e, &appdir)).collect();
        if key == "XDG_DATA_DIRS" {
            let mut last: Vec<&str> = Vec::new();
            for e in kept.into_iter().rev() {
                if !last.contains(&e) {
                    last.push(e);
                }
            }
            last.reverse();
            kept = last;
        }
        out.push((key.clone(), (!kept.is_empty()).then(|| kept.join(":"))));
    }
    out
}

/// True when the app runs from its AppImage, and children need [`apply`].
pub fn inside_appimage() -> bool {
    std::env::var_os("APPDIR").is_some_and(|d| !d.is_empty())
}

/// Give `cmd` the host's environment instead of the AppImage's. Nothing outside an AppImage.
pub fn apply(cmd: &mut Command) {
    let vars = std::env::vars_os().filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)));
    for (key, value) in changes(vars) {
        match value {
            Some(v) => cmd.env(key, v),
            None => cmd.env_remove(key),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const APPDIR: &str = "/tmp/.mount_Dota-2JlkBiE";

    /// The variables a child of 4.1.0's AppImage got on Linux Mint 22 (Cinnamon), trimmed.
    fn mint() -> Vec<(String, String)> {
        let a = APPDIR;
        [
            ("APPDIR", a.to_string()),
            ("APPIMAGE", "/home/u/Apps/Dota-2-Mod-Manager.AppImage".into()),
            ("ARGV0", "/home/u/Apps/Dota-2-Mod-Manager.AppImage".into()),
            ("OWD", "/home/u".into()),
            ("HOME", "/home/u".into()),
            ("GTK_THEME", "Adwaita:dark".into()),
            ("GTK3_MODULES", "xapp-gtk3-module".into()),
            ("LD_LIBRARY_PATH", format!("{a}/usr/lib/:{a}/usr/lib/x86_64-linux-gnu/:{a}/lib/:")),
            ("GIO_MODULE_DIR", format!("{a}//usr/lib/gio/modules")),
            ("GSETTINGS_SCHEMA_DIR", format!("{a}/usr/share/glib-2.0/schemas/:{a}//usr/share/glib-2.0/schemas")),
            ("PATH", format!("{a}/usr/bin/:{a}/bin/:/home/u/.local/bin:/usr/local/bin:/usr/bin:/bin")),
            (
                "XDG_DATA_DIRS",
                format!(
                    "{a}/usr/share/:{a}/usr/share:/usr/share:/usr/share/cinnamon:/home/u/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/usr/local/share:/usr/share"
                ),
            ),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect()
    }

    fn got(key: &str) -> Option<Option<String>> {
        changes(mint()).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    #[test]
    fn the_browser_list_is_the_persons_again() {
        // /usr/share first made xdg-open pick Chromium over the Flatpak Brave the person chose
        assert_eq!(
            got("XDG_DATA_DIRS"),
            Some(Some(
                "/usr/share/cinnamon:/home/u/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/usr/local/share:/usr/share".into()
            ))
        );
    }

    #[test]
    fn host_programs_load_the_hosts_libraries() {
        assert_eq!(got("LD_LIBRARY_PATH"), Some(None));
        assert_eq!(got("GIO_MODULE_DIR"), Some(None));
        assert_eq!(got("GSETTINGS_SCHEMA_DIR"), Some(None));
        assert_eq!(got("PATH"), Some(Some("/home/u/.local/bin:/usr/local/bin:/usr/bin:/bin".into())));
    }

    #[test]
    fn what_the_image_says_about_itself_goes() {
        for k in ABOUT_THE_IMAGE {
            assert_eq!(got(k), Some(None), "{k}");
        }
    }

    #[test]
    fn the_persons_own_settings_stay() {
        for k in ["HOME", "GTK_THEME", "GTK3_MODULES"] {
            assert_eq!(got(k), None, "{k}");
        }
    }

    #[test]
    fn a_folder_that_only_starts_like_the_image_is_kept() {
        let vars = [("APPDIR", APPDIR.to_string()), ("PATH", format!("{APPDIR}/usr/bin:{APPDIR}-other/bin:/usr/bin"))];
        assert_eq!(
            changes(vars),
            vec![("APPDIR".into(), None), ("PATH".into(), Some(format!("{APPDIR}-other/bin:/usr/bin")))]
        );
    }

    #[test]
    fn outside_an_appimage_nothing_changes() {
        let vars: Vec<_> = mint().into_iter().filter(|(k, _)| k != "APPDIR").collect();
        assert!(changes(vars).is_empty());
        assert!(changes([("APPDIR", "/"), ("PATH", "/usr/bin")]).is_empty());
    }
}
