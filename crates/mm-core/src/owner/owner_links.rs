//! d2mm:// links under the owner (src/main.ts takeLink, src/deep-links.ts handleDeepLink): the one
//! the app was started by, told to the page once it has loaded, and one a second start hands over.
//! A preset parks in the Presets tab, a mod opens its window in the catalog; nothing installs.

use serde_json::{json, Value};

use crate::owner::Owner;

/// Route a link to the window: the importer's answer for a preset, the mod it names for a mod
/// link (or null, which the window says it could not read). Anything not d2mm:// is dropped.
pub fn take(o: &Owner, url: Option<&str>) {
    let routed = {
        let mut c = o.core();
        crate::deep_links::route(url, &mut |code| {
            crate::presets_service::import_preset_link(&mut c.library, &json!(code))
        })
    };
    let Some((channel, payload)) = routed else { return };
    let _ = o.shell.request("win.show", vec![]);
    let _ = o.shell.request("win.focus", vec![]);
    o.shell.event(channel, vec![payload]);
}

/// The first d2mm:// link on a command line.
pub fn first(argv: &[String]) -> Option<String> {
    crate::deep_links::first_link(&argv.iter().map(|a| Value::String(a.clone())).collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{Options, Shell};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Told(Mutex<Vec<String>>);
    impl Shell for Told {
        fn event(&self, channel: &str, args: Vec<Value>) {
            self.0.lock().unwrap().push(format!("{channel} {}", args.first().unwrap_or(&Value::Null)));
        }
        fn request(&self, method: &str, _args: Vec<Value>) -> Result<Value, String> {
            self.0.lock().unwrap().push(method.to_string());
            Ok(Value::Null)
        }
    }

    #[test]
    fn a_mod_link_opens_its_window_and_anything_else_is_dropped() {
        let ud = std::env::temp_dir().join(format!("mm-owner-links-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        std::fs::write(ud.join("settings.json"), "{}").unwrap();
        let told = Arc::new(Told::default());
        let o = Owner::start(
            Options {
                user_data: ud.clone(),
                app_version: "9.9.9".into(),
                app_root: ud.clone(),
                downloads: ud.clone(),
                uninstall: false,
                system_languages: None,
                find_game: Box::new(|| None),
                dota_running: Box::new(|| false),
                now: crate::net_fetch::now_ms,
            },
            told.clone(),
        );
        told.0.lock().unwrap().clear();
        let argv = vec!["app.exe".to_string(), "--x".into(), "d2mm://mod/heroes/Some%20Mod".into()];
        assert_eq!(first(&argv).as_deref(), Some("d2mm://mod/heroes/Some%20Mod"));
        take(&o, first(&argv).as_deref());
        take(&o, Some("https://example.com/"));
        take(&o, None);
        let got = told.0.lock().unwrap().clone();
        assert_eq!(got[..2], ["win.show".to_string(), "win.focus".to_string()]);
        assert_eq!(got[2], r#"mod-link {"cat":"heroes","name":"Some Mod","style":null}"#);
        assert_eq!(got.len(), 3, "{got:?}");
        // a preset link the importer cannot read still reaches the window, which says so
        take(&o, Some("d2mm://preset/garbage"));
        assert!(told.0.lock().unwrap().last().unwrap().starts_with("preset-link "));
        drop(o);
        let _ = std::fs::remove_dir_all(ud);
    }
}
