//! The app beside the game rather than in front of it (src/tray.ts, plan item 9). By default it
//! starts with Windows, hidden, and closing the window hides it in the tray instead of quitting,
//! so the patch watcher keeps running. Off, the app closes when its window does.
//!
//! This is the logic alone: the shell (src-tauri) owns the icon, the menu and the window, and
//! does what `TrayKeeper` answers.

use serde_json::Value;

use crate::i18n::t;

/// The argument Windows starts the app with at sign-in: no window, only the tray.
pub const BACKGROUND_ARG: &str = "--background";
/// The name of the app's line under HKCU\...\Run.
pub const LOGIN_ITEM_NAME: &str = "Dota 2 Mod Manager";
/// The icon's tooltip and the hint's title.
pub const TITLE: &str = "Dota 2 Mod Manager";

/// Started by Windows at sign-in rather than by a person.
pub fn started_hidden(argv: &[String]) -> bool {
    argv.iter().any(|a| a == BACKGROUND_ARG)
}

/// The setting, on unless turned off.
pub fn in_background(settings: &Value) -> bool {
    settings.get("runInBackground") != Some(&Value::Bool(false))
}

/// Whether the app may put itself in front of the next sign-in: only an installed Windows build,
/// never a portable copy (its folder is gone after it exits), a dev run or a jailed run.
pub fn login_item_allowed(windows: bool, packaged: bool, portable: bool, jailed: bool) -> bool {
    windows && packaged && !portable && !jailed
}

/// One line of the icon's menu: its id, and its label in the current language (None: a separator).
pub fn menu() -> Vec<(&'static str, Option<String>)> {
    vec![
        ("open", Some(t("Открыть", &[]))),
        ("play", Some(t("Играть", &[]))),
        ("sep", None),
        ("quit", Some(t("Выйти", &[]))),
    ]
}

/// What was said the first time the window went to the tray.
pub fn hint() -> String {
    t(
        "Приложение работает в трее и вернёт моды после обновления Доты. Выйти можно правым кликом по значку, отключить в Настройках.",
        &[],
    )
}

/// What `sync` asks of the icon.
#[derive(Debug, PartialEq, Eq)]
pub enum Icon {
    Make,
    Destroy,
    Keep,
}

/// What the window does when it is asked to close.
#[derive(Debug, PartialEq, Eq)]
pub enum Close {
    /// Let it close: the app is quitting, or the setting is off.
    Close,
    /// Hide it instead; `hint` the first time, and then trayHintSeen is set.
    Hide { hint: bool },
}

/// The tray's state: whether the icon is there and whether the app is quitting.
#[derive(Default, Debug)]
pub struct TrayKeeper {
    pub icon: bool,
    pub quitting: bool,
}

impl TrayKeeper {
    /// The icon there while the setting is on and gone when it is off; the menu is filled after
    /// either way, in the current language.
    pub fn sync(&mut self, settings: &Value) -> Icon {
        let on = in_background(settings);
        if on && !self.icon {
            self.icon = true;
            Icon::Make
        } else if !on && self.icon {
            self.icon = false;
            Icon::Destroy
        } else {
            Icon::Keep
        }
    }

    /// The window asked to close.
    pub fn close(&self, settings: &Value) -> Close {
        if self.quitting || !in_background(settings) {
            return Close::Close;
        }
        Close::Hide { hint: !crate::js::truthy(settings.get("trayHintSeen").unwrap_or(&Value::Null)) }
    }
}
