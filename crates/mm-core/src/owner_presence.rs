//! The user's Discord status while the app is open (src/presence-status.ts createPresenceStatus):
//! the screen the window names and how many mods are on, said again when either changes, and torn
//! down when the setting turns it off. The connection is started by the shell, so an owner without
//! one (the parity's) says nothing.

use std::sync::Arc;

use serde_json::Value;

use crate::owner::Owner;

/// The connection, off until the setting allows it.
pub fn start(o: &Arc<Owner>) {
    let w = Arc::downgrade(o);
    let presence = crate::discord_presence::Presence::new(
        crate::discord_auth::CLIENT_ID,
        Box::new(move |m| {
            if let Some(o) = w.upgrade() {
                o.diag(m);
            }
        }),
    );
    if o.presence.set(presence).is_ok() {
        apply(o);
    }
}

fn wanted(o: &Owner) -> bool {
    o.core().settings.get("discordPresence") != Some(&Value::Bool(false))
}

/// The status for now: the screen, and what loads.
pub fn current(o: &Owner) -> Value {
    let c = o.core();
    let mods = c.library.list().iter().filter(|r| r.get("enabled").is_some_and(crate::js::truthy)).count();
    // the master switch renames files rather than clearing each record's flag
    let master_off = c.installer.master_is_off().unwrap_or(false);
    crate::presence_status::presence_activity(&c.presence_view, mods as f64, master_off)
}

/// Say what is true now, if the status is on at all. Called without the owner's lock.
pub fn refresh(o: &Owner) {
    if let Some(p) = o.presence.get() {
        if wanted(o) {
            p.set(current(o));
        }
    }
}

/// Follow the setting: turning it off tears the connection down, not just the updates.
pub fn apply(o: &Owner) {
    let Some(p) = o.presence.get() else { return };
    if !wanted(o) {
        p.stop();
        return;
    }
    p.start();
    p.set(current(o));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{Options, Shell};
    use serde_json::json;

    struct Quiet;
    impl Shell for Quiet {
        fn event(&self, _channel: &str, _args: Vec<Value>) {}
        fn request(&self, _method: &str, _args: Vec<Value>) -> Result<Value, String> {
            Ok(Value::Null)
        }
    }

    #[test]
    fn the_status_names_the_screen_and_an_owner_without_a_connection_says_nothing() {
        let ud = std::env::temp_dir().join(format!("mm-owner-presence-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        std::fs::write(ud.join("settings.json"), r#"{"uiLang":"en"}"#).unwrap();
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
            Arc::new(Quiet),
        );
        assert_eq!(o.invoke("presence:view", &[json!("settings")]), Some(Ok(Value::Null)));
        let a = current(&o);
        assert_eq!(a["details"], json!(crate::i18n::t("В настройках", &[])));
        assert_eq!(a["state"], json!(crate::i18n::t("Ещё без модов", &[])));
        // nothing connected: refresh and apply are no-ops
        refresh(&o);
        apply(&o);
        assert!(o.presence.get().is_none());
        drop(o);
        let _ = std::fs::remove_dir_all(ud);
    }
}
