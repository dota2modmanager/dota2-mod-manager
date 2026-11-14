//! The window's language on the very first start, before the person has picked one: the
//! system's (src/ui-lang.ts). Russian also covers the languages whose speakers usually read it
//! here; anything the app has no translation for stays English.

/// The languages a system names that get the Russian window.
const RUSSIAN: [&str; 10] = ["ru", "uk", "be", "kk", "ky", "uz", "tg", "hy", "az", "ka"];

/// The app's language for a system's list of preferred ones ("ru-RU", "zh-Hans-CN"), first
/// match wins.
pub fn ui_lang_for<S: AsRef<str>>(locales: &[S]) -> &'static str {
    for locale in locales {
        let low = locale.as_ref().to_lowercase();
        let base = low.split(['-', '_']).next().unwrap_or("");
        if RUSSIAN.contains(&base) {
            return "ru";
        }
        if base == "zh" {
            return "zh-CN";
        }
        if base == "en" {
            return "en";
        }
    }
    "en"
}
