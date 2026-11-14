//! Where an installed copy looks for a new version, and on which channel (src/updater.ts).
//!
//! Two feeds: GitHub is the origin, the project's bucket a copy tried only after GitHub fails,
//! and each four-hourly round starts at GitHub again. Two channels: everybody reads `latest`, the
//! testers read `beta`, re-read on every check so a tester taken off the list is back on the
//! stable channel at the next one. A portable copy cannot replace itself, so it is told where a
//! new one is rather than handed a download.
//!
//! The updater itself (electron-updater there, Tauri's here) is behind [`UpdaterLike`]; its
//! events come in through [`Updater::available`], [`Updater::downloaded`] and [`Updater::error`],
//! and the shell runs [`Updater::round`] every [`EVERY`] ms.

use crate::beta::BETA_CHANNEL;
use serde::Serialize;

/// The copy of each release this project keeps, for the hours GitHub is not answering.
pub const MIRROR: &str = "https://cdn.dota2modmanager.com/updates/";
/// How often an open window looks again.
pub const EVERY: u64 = 4 * 60 * 60 * 1000;

/// One address for both channels: the updater asks for latest or beta by itself.
pub fn mirror_for() -> &'static str {
    MIRROR
}

/// Where the updater is pointed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "provider", rename_all = "lowercase")]
pub enum Feed {
    Github { owner: &'static str, repo: &'static str },
    Generic { url: &'static str },
}

const GITHUB: Feed = Feed::Github { owner: "dota2modmanager", repo: "dota2-mod-manager" };

/// What of the updater this drives; the tests hand in a stand-in.
pub trait UpdaterLike {
    fn set_channel(&mut self, name: &str);
    fn set_allow_prerelease(&mut self, on: bool);
    fn set_auto_download(&mut self, on: bool);
    /// An Err is a feed the updater could not use.
    fn set_feed(&mut self, feed: Feed) -> Result<(), String>;
    /// Look; what it finds comes back as an event.
    fn check(&mut self);
}

/// The shell's updater as the owner keeps it, behind a box.
impl<T: UpdaterLike + ?Sized> UpdaterLike for Box<T> {
    fn set_channel(&mut self, name: &str) {
        (**self).set_channel(name)
    }
    fn set_allow_prerelease(&mut self, on: bool) {
        (**self).set_allow_prerelease(on)
    }
    fn set_auto_download(&mut self, on: bool) {
        (**self).set_auto_download(on)
    }
    fn set_feed(&mut self, feed: Feed) -> Result<(), String> {
        (**self).set_feed(feed)
    }
    fn check(&mut self) {
        (**self).check()
    }
}

/// What the window is told: a version exists, is fetched, or is to be fetched beside a portable copy.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UpdateNews {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub version: String,
}

/// The driver: the channel, the feed in use and what went wrong last.
pub struct Updater<U: UpdaterLike> {
    pub inner: U,
    is_portable: bool,
    channel: Box<dyn Fn() -> String + Send>,
    send: Box<dyn FnMut(UpdateNews) + Send>,
    log: Box<dyn FnMut(&str) + Send>,
    started: bool,
    last_error: Option<String>,
    portable_version: Option<String>,
    on_mirror: bool,
}

impl<U: UpdaterLike> Updater<U> {
    pub fn new(
        inner: U,
        is_portable: bool,
        channel: Box<dyn Fn() -> String + Send>,
        send: Box<dyn FnMut(UpdateNews) + Send>,
        log: Box<dyn FnMut(&str) + Send>,
    ) -> Updater<U> {
        Updater {
            inner,
            is_portable,
            channel,
            send,
            log,
            started: false,
            last_error: None,
            portable_version: None,
            on_mirror: false,
        }
    }

    /// Point the updater at a feed for this channel, and say which one it is.
    fn aim(&mut self, mirror: bool) -> bool {
        let name = (self.channel)();
        self.inner.set_channel(&name);
        // a beta is a prerelease on GitHub, and the stable channel must never be offered one
        self.inner.set_allow_prerelease(name == BETA_CHANNEL);
        if let Err(e) = self.inner.set_feed(if mirror { Feed::Generic { url: mirror_for() } } else { GITHUB }) {
            (self.log)(&format!("update feed unusable: {e}"));
            return false;
        }
        self.on_mirror = mirror;
        true
    }

    fn check(&mut self) {
        if self.aim(self.on_mirror) {
            self.inner.check();
        }
    }

    /// The first look; the shell then calls [`Updater::round`] every [`EVERY`] ms.
    pub fn start(&mut self) {
        self.inner.set_auto_download(!self.is_portable);
        self.started = true;
        self.check();
    }

    /// The four-hourly look, which starts at the origin again.
    pub fn round(&mut self) {
        self.on_mirror = false;
        self.check();
    }

    /// The channel may have changed: re-aim and look now rather than in four hours.
    pub fn recheck(&mut self) -> String {
        self.on_mirror = false;
        self.check();
        (self.channel)()
    }

    /// The updater found a version.
    pub fn available(&mut self, version: &str) {
        if !self.started {
            return;
        }
        if self.is_portable {
            self.portable_version = Some(version.to_string());
        }
        (self.send)(UpdateNews {
            kind: if self.is_portable { "portable" } else { "available" },
            version: version.to_string(),
        });
    }

    /// The updater has the new version on disk.
    pub fn downloaded(&mut self, version: &str) {
        if self.started {
            (self.send)(UpdateNews { kind: "downloaded", version: version.to_string() });
        }
    }

    /// Silent for the user, but remembered, because "it never updates" is a support question;
    /// on GitHub the mirror is tried once.
    pub fn error(&mut self, message: &str) {
        if !self.started {
            return;
        }
        let e = crate::js::slice_utf16(message, 500);
        self.last_error = Some(e.clone());
        if self.on_mirror {
            return;
        }
        (self.log)(&format!("update check failed on GitHub, trying the mirror: {e}"));
        if self.aim(true) {
            self.inner.check();
        }
    }

    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    pub fn portable_version(&self) -> Option<&str> {
        self.portable_version.as_deref()
    }

    pub fn channel(&self) -> String {
        (self.channel)()
    }
}
