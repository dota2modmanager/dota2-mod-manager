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

/// The variables the AppImage runtime adds about itself, and the mark [`host_libs_plan`] leaves:
/// a program the app starts, an update of itself included, decides that for itself.
const ABOUT_THE_IMAGE: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD", HOST_LIBS_MARK];

/* The libraries the app itself runs on (#761, #797). The AppImage is built on Ubuntu 24.04 and
 * carries that machine's WebKitGTK, GTK, GLib, ICU, libsystemd, libelf, libzstd and half of
 * Wayland (libwayland-egl and -server, not -client, which comes from the host). The host's GPU
 * driver never comes from the image: Mesa is loaded from the host, and on a rolling distribution
 * it was built against newer copies of the libraries the image puts first. On EndeavourOS with
 * KDE on Wayland that mix drew a black window, or one without its menu, and deleting usr/lib from
 * the unpacked image put it right. On Arch with Hyprland and Intel Xe (#797, 4.0 to 4.5.0) GTK
 * could not set up GL and the app died with a segfault before its window opened.
 *
 * So from the AppImage the app starts once more with the host's library folders ahead of the
 * image's in LD_LIBRARY_PATH. The image's binaries name their folder in RUNPATH, which
 * LD_LIBRARY_PATH goes before, so whatever the host has comes from the host and whatever it lacks
 * still comes from the image. 4.3.0 to 4.5.0 did this only when the host had its own WebKitGTK
 * 4.1; #797's machine had none, so it kept the whole bundle, Mesa and all. A host without WebKitGTK
 * now runs the image's WebKitGTK and JavaScriptCore on the host's GTK, GLib and the rest: the
 * AppImage needs glibc 2.39 (linux.yml), so the host is at least as new as Ubuntu 24.04, and a
 * library keeps its soname only while it stays compatible with older callers. ICU changes its
 * soname every release, so libicu*.so.74 still comes from the image.
 *
 * GTK's module lookups that point into the image go only where the host has that library itself,
 * or the host's GTK would load loaders and modules built against the image's GLib, while the
 * image's GTK on a host without one still finds its own. D2MM_BUNDLED_LIBS=1 asks for the bundle
 * on any host. */

/// Set on the second start, so the app starts again only once.
pub const HOST_LIBS_MARK: &str = "D2MM_HOST_LIBS";
/// Set by a person who wants the libraries the AppImage carries whatever the host has.
pub const BUNDLED_LIBS: &str = "D2MM_BUNDLED_LIBS";
/// Where distributions keep 64-bit shared libraries: Debian and Ubuntu, Fedora, Arch.
const HOST_LIB_DIRS: &[&str] = &["/usr/lib/x86_64-linux-gnu", "/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib"];
/// What linuxdeploy's GTK hook points into the image, and the library that reads it: dropped when
/// the host has that library, kept for the image's copy when it does not.
const BUNDLE_LOOKUPS: &[(&str, &str)] = &[
    ("GTK_PATH", "libgtk-3.so.0"),
    ("GTK_EXE_PREFIX", "libgtk-3.so.0"),
    ("GTK_DATA_PREFIX", "libgtk-3.so.0"),
    ("GTK_IM_MODULE_FILE", "libgtk-3.so.0"),
    ("GDK_PIXBUF_MODULE_FILE", "libgdk_pixbuf-2.0.so.0"),
    ("GIO_MODULE_DIR", "libgio-2.0.so.0"),
    ("GSETTINGS_SCHEMA_DIR", "libgio-2.0.so.0"),
    ("GI_TYPELIB_PATH", "libgio-2.0.so.0"),
];

/// The environment to start the app again with, on the host's libraries, or None to run on as
/// it is. `exists` answers for a path on the host (a folder or a file).
pub fn host_libs_plan<I, K, V>(vars: I, exists: impl Fn(&str) -> bool) -> Option<Vec<(String, Option<String>)>>
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    let vars: Vec<(String, String)> = vars.into_iter().map(|(k, v)| (k.into(), v.into())).collect();
    let get = |name: &str| vars.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str());
    get("APPDIR").filter(|d| !d.is_empty())?;
    if get(HOST_LIBS_MARK).is_some() || get(BUNDLED_LIBS) == Some("1") {
        return None;
    }
    let host: Vec<&str> = HOST_LIB_DIRS.iter().copied().filter(|d| exists(d)).collect();
    // no folder of the usual kind (NixOS and the like): nothing to put first
    if host.is_empty() {
        return None;
    }
    let host_has = |lib: &str| host.iter().any(|d| exists(&format!("{d}/{lib}")));
    let mut path = host.clone();
    path.extend(get("LD_LIBRARY_PATH").unwrap_or("").split(':').filter(|e| !e.is_empty()));
    let mut out = vec![("LD_LIBRARY_PATH".to_string(), Some(path.join(":")))];
    out.extend(
        BUNDLE_LOOKUPS.iter().filter(|(k, lib)| get(k).is_some() && host_has(lib)).map(|(k, _)| (k.to_string(), None)),
    );
    out.push((HOST_LIBS_MARK.to_string(), Some("1".into())));
    Some(out)
}

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
        // the runtime's own four; the app's mark has a test of its own below
        for k in ABOUT_THE_IMAGE.iter().filter(|k| **k != HOST_LIBS_MARK) {
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

    /// The host as EndeavourOS has it (#761): Arch keeps everything in /usr/lib, /usr/lib64 links
    /// there, and WebKitGTK 4.1 is installed.
    fn arch(p: &str) -> bool {
        let p = p.strip_prefix("/usr/lib64").map(|rest| format!("/usr/lib{rest}")).unwrap_or(p.to_string());
        matches!(
            p.as_str(),
            "/usr/lib"
                | "/usr/lib/libwebkit2gtk-4.1.so.0"
                | "/usr/lib/libgtk-3.so.0"
                | "/usr/lib/libgdk_pixbuf-2.0.so.0"
        )
    }

    /// The host as #797 has it: Arch with Hyprland, GTK 3 there for other programs, no WebKitGTK.
    fn arch_without_webkit(p: &str) -> bool {
        arch(p) && !p.ends_with("libwebkit2gtk-4.1.so.0")
    }

    fn image() -> Vec<(String, String)> {
        let a = APPDIR;
        vec![
            ("APPDIR".into(), a.into()),
            ("LD_LIBRARY_PATH".into(), format!("{a}/usr/lib/:{a}/lib/:")),
            ("GTK_PATH".into(), format!("{a}//usr/lib/gtk-3.0")),
            ("GDK_PIXBUF_MODULE_FILE".into(), format!("{a}//usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache")),
            ("GTK_THEME".into(), "Adwaita:dark".into()),
        ]
    }

    fn plan_get(plan: &[(String, Option<String>)], k: &str) -> Option<Option<String>> {
        plan.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone())
    }

    #[test]
    fn a_host_with_its_own_webkit_runs_the_app_on_its_own_libraries() {
        let plan = host_libs_plan(image(), arch).expect("starts again");
        let get = |k: &str| plan_get(&plan, k);
        // the host's folders first, the image's after them for what the host lacks
        assert_eq!(get("LD_LIBRARY_PATH"), Some(Some(format!("/usr/lib64:/usr/lib:{APPDIR}/usr/lib/:{APPDIR}/lib/"))));
        assert_eq!(get("GTK_PATH"), Some(None));
        assert_eq!(get("GDK_PIXBUF_MODULE_FILE"), Some(None));
        assert_eq!(get(HOST_LIBS_MARK), Some(Some("1".into())));
        // only what points into the image's GTK goes; the theme the hook picked stays
        assert_eq!(get("GTK_THEME"), None);
    }

    #[test]
    fn a_host_without_webkit_still_puts_its_own_libraries_first() {
        // #797: 4.5.0 kept the whole bundle here, and the host's Mesa ran on the image's libelf,
        // libzstd and libsystemd until GTK gave up on GL and the app crashed
        let plan = host_libs_plan(image(), arch_without_webkit).expect("starts again");
        let get = |k: &str| plan_get(&plan, k);
        assert_eq!(get("LD_LIBRARY_PATH"), Some(Some(format!("/usr/lib64:/usr/lib:{APPDIR}/usr/lib/:{APPDIR}/lib/"))));
        assert_eq!(get("GTK_PATH"), Some(None));
        assert_eq!(get(HOST_LIBS_MARK), Some(Some("1".into())));
        // Ubuntu and Mint as installed have no WebKitGTK 4.1 either; same versions, same plan
        let ubuntu = |p: &str| {
            p == "/usr/lib/x86_64-linux-gnu" || p == "/usr/lib" || p == "/usr/lib/x86_64-linux-gnu/libgtk-3.so.0"
        };
        let plan = host_libs_plan(image(), ubuntu).expect("starts again");
        assert_eq!(
            plan_get(&plan, "LD_LIBRARY_PATH"),
            Some(Some(format!("/usr/lib/x86_64-linux-gnu:/usr/lib:{APPDIR}/usr/lib/:{APPDIR}/lib/")))
        );
    }

    #[test]
    fn the_images_gtk_keeps_its_own_modules_where_the_host_has_no_gtk() {
        // a bare window-manager install with no GTK 3: the image's GTK and gdk-pixbuf load, and
        // without these they would look for their loaders in Ubuntu's folders on an Arch host
        let plan = host_libs_plan(image(), |p| p == "/usr/lib").expect("starts again");
        assert_eq!(plan_get(&plan, "GTK_PATH"), None);
        assert_eq!(plan_get(&plan, "GDK_PIXBUF_MODULE_FILE"), None);
        // the host has GTK but not gdk-pixbuf: only GTK's own lookups go
        let plan = host_libs_plan(image(), |p| p == "/usr/lib" || p == "/usr/lib/libgtk-3.so.0").expect("starts again");
        assert_eq!(plan_get(&plan, "GTK_PATH"), Some(None));
        assert_eq!(plan_get(&plan, "GDK_PIXBUF_MODULE_FILE"), None);
    }

    #[test]
    fn the_bundle_stays_when_asked_or_the_app_already_started_again() {
        let mut again = image();
        again.push((HOST_LIBS_MARK.into(), "1".into()));
        assert!(host_libs_plan(again, arch).is_none());
        let mut asked = image();
        asked.push((BUNDLED_LIBS.into(), "1".into()));
        assert!(host_libs_plan(asked, arch).is_none());
        // a build that is not the AppImage
        assert!(host_libs_plan(image().into_iter().filter(|(k, _)| k != "APPDIR"), arch).is_none());
        // a host with none of the usual library folders (NixOS): nothing of its own to put first
        assert!(host_libs_plan(image(), |_| false).is_none());
    }

    #[test]
    fn a_program_the_app_starts_does_not_inherit_the_mark() {
        let vars = [("APPDIR", APPDIR), (HOST_LIBS_MARK, "1")];
        assert!(changes(vars).contains(&(HOST_LIBS_MARK.to_string(), None)));
    }
}
