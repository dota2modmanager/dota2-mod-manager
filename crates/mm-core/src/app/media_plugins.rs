//! Whether WebKitGTK can play video and sound on this Linux machine, or would crash trying (#797).
//!
//! WebKitGTK plays `<video>`, `<audio>` and Web Audio through GStreamer, and when an element it
//! counts on is missing (appsink, playbin, autoaudiosink) its page process aborts instead of
//! failing the one video. The window then freezes and goes black. Arch's webkit2gtk-4.1 needs
//! only GStreamer's libraries, not the plugins, so a minimal Arch (Hyprland, #797) meets this as
//! soon as the catalog shows a card with a video; the bug against Arch's own browser is
//! FS#79615. The app cannot catch it from the page, so it looks for the plugins before the window
//! opens and, without them, turns media off in WebKit and tells the person what to install.
//!
//! The look is by file: each plugin is one shared library in a GStreamer plugin folder.

/// A plugin file WebKit needs, and the package that carries it on most distributions.
const NEEDED: &[(&str, &str)] = &[
    // appsink and appsrc: every video and sound WebKit plays ends in one
    ("libgstapp.so", "gst-plugins-base"),
    // playbin and uridecodebin
    ("libgstplayback.so", "gst-plugins-base"),
    // autoaudiosink: sound out
    ("libgstautodetect.so", "gst-plugins-good"),
];

/// Where distributions keep GStreamer's plugins: Arch, Fedora, Debian and Ubuntu, a local build.
const SYSTEM_DIRS: &[&str] = &[
    "/usr/lib/gstreamer-1.0",
    "/usr/lib64/gstreamer-1.0",
    "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
    "/usr/local/lib/gstreamer-1.0",
];

/// The variables GStreamer itself reads its plugin folders from (NixOS and Flatpak set them).
const PATH_VARS: &[&str] =
    &["GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_PATH_1_0", "GST_PLUGIN_PATH"];

/// The packages to install for WebKit to play media, empty when every plugin is found. `get`
/// reads an environment variable, `exists` answers for a file.
pub fn missing_packages(get: impl Fn(&str) -> Option<String>, exists: impl Fn(&str) -> bool) -> Vec<&'static str> {
    let mut dirs: Vec<String> = PATH_VARS
        .iter()
        .filter_map(|v| get(v))
        .flat_map(|list| list.split(':').filter(|d| !d.is_empty()).map(str::to_string).collect::<Vec<_>>())
        .collect();
    dirs.extend(SYSTEM_DIRS.iter().map(|d| d.to_string()));
    if let Some(home) = get("HOME").filter(|h| !h.is_empty()) {
        dirs.push(format!("{home}/.local/share/gstreamer-1.0/plugins"));
    }
    let mut out: Vec<&'static str> = Vec::new();
    for (file, package) in NEEDED {
        let found = dirs.iter().any(|d| exists(&format!("{}/{file}", d.trim_end_matches('/'))));
        if !found && !out.contains(package) {
            out.push(package);
        }
    }
    out
}

/// Turns media off in the page: no `<video>`, `<audio>` or Web Audio, so nothing reaches GStreamer.
pub const PAGE_FLAG: &str = "__mmMediaOff";

/// The line for the page's initialization script: the packages it tells the person to install.
pub fn page_script(missing: &[&str]) -> String {
    format!("window.{PAGE_FLAG} = {};", serde_json::to_string(missing).unwrap_or_else(|_| "[]".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arch_with<'a>(files: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |p: &str| files.iter().any(|f| p == format!("/usr/lib/gstreamer-1.0/{f}"))
    }
    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k: &str| vars.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn a_minimal_arch_lacks_both_packages() {
        // #797: GStreamer's libraries only, as webkit2gtk-4.1 pulls them in
        let got = missing_packages(env(&[("HOME", "/home/u")]), arch_with(&["libgstcoreelements.so"]));
        assert_eq!(got, ["gst-plugins-base", "gst-plugins-good"]);
    }

    #[test]
    fn base_alone_still_has_no_sound_out() {
        let got = missing_packages(env(&[]), arch_with(&["libgstapp.so", "libgstplayback.so"]));
        assert_eq!(got, ["gst-plugins-good"]);
    }

    #[test]
    fn a_machine_with_the_plugins_plays_media() {
        let all = ["libgstapp.so", "libgstplayback.so", "libgstautodetect.so"];
        assert!(missing_packages(env(&[]), arch_with(&all)).is_empty());
        // Ubuntu's folder
        let ubuntu = |p: &str| all.iter().any(|f| p == format!("/usr/lib/x86_64-linux-gnu/gstreamer-1.0/{f}"));
        assert!(missing_packages(env(&[]), ubuntu).is_empty());
    }

    #[test]
    fn the_folders_gstreamer_is_told_about_count() {
        // NixOS: plugins in the store, named by the variable
        let vars = [(
            "GST_PLUGIN_SYSTEM_PATH_1_0",
            "/nix/store/a-base/lib/gstreamer-1.0:/nix/store/b-good/lib/gstreamer-1.0/",
        )];
        let nix = |p: &str| {
            p == "/nix/store/a-base/lib/gstreamer-1.0/libgstapp.so"
                || p == "/nix/store/a-base/lib/gstreamer-1.0/libgstplayback.so"
                || p == "/nix/store/b-good/lib/gstreamer-1.0/libgstautodetect.so"
        };
        assert!(missing_packages(env(&vars), nix).is_empty());
    }

    #[test]
    fn the_page_hears_the_packages() {
        assert_eq!(page_script(&["gst-plugins-good"]), r#"window.__mmMediaOff = ["gst-plugins-good"];"#);
    }
}
