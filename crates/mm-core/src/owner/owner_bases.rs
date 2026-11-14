//! The arcana bases as the owner's builds read them (src/services.ts createBaseStore): a base on
//! disk is read without any lock, one that is not is brought down on a thread of its own, and
//! when one lands the item table is built again, and the arcana window's Terrorblade too once the
//! table is done, if it was built whole from Valve's files.
//!
//! The network is never waited on under the owner's lock: the build that asks goes on from the
//! game's files, as the TypeScript does while its fetch is pending.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use serde_json::Value;

use crate::arcana_base_store::{BaseStore, Got};
use crate::arcana_bases::{BaseSource, TERRORBLADE_BASE};
use crate::net_fetch::{FetchOptions, Net};
use crate::owner::Owner;
use crate::vpk::Entry;

pub struct OwnerBases {
    dir: PathBuf,
    net: Arc<Net>,
    now: fn() -> f64,
    log: Arc<crate::app_log::AppLog>,
    /// the store that fetches: what was asked this run, and when a fetch last failed
    fetcher: Arc<Mutex<BaseStore>>,
    owner: OnceLock<Weak<Owner>>,
}

impl OwnerBases {
    pub fn new(user_data: &Path, net: Arc<Net>, now: fn() -> f64, log: Arc<crate::app_log::AppLog>) -> Arc<OwnerBases> {
        let dir = user_data.join("arcana-bases");
        Arc::new(OwnerBases {
            fetcher: Arc::new(Mutex::new(BaseStore::new(&dir))),
            dir,
            net,
            now,
            log,
            owner: OnceLock::new(),
        })
    }

    /// Whom to tell that a base landed; until then a landed base waits for the next build.
    pub fn attach(&self, owner: Weak<Owner>) {
        let _ = self.owner.set(owner);
    }

    /// Bring one base down now, on this thread; whether the disk changed.
    pub fn fetch_now(&self, id: &str) -> bool {
        let net = self.net.clone();
        let fetch = move |url: &str, small: bool| -> Result<Got, String> {
            let a = net.fetch_mirrored(url, FetchOptions { small, ..Default::default() }).map_err(|e| e.message)?;
            let status = a.status;
            Ok(Got { status, body: a.bytes().map_err(|e| e.message)? })
        };
        let log = self.log.clone();
        let mut store = self.fetcher.lock().unwrap_or_else(|e| e.into_inner());
        store.want(id, &fetch, (self.now)(), &mut |m| log.push(&m))
    }
}

impl BaseSource for OwnerBases {
    fn entries(&self, id: &str) -> Option<Vec<Entry>> {
        // read from disk as it is now: the fetching store's lock is never taken by a build
        BaseStore::new(&self.dir).entries(id)
    }

    fn want(&self, id: &str) {
        let Some(owner) = self.owner.get().cloned() else { return };
        let id = id.to_string();
        std::thread::spawn(move || {
            let Some(o) = owner.upgrade() else { return };
            let bases = o.core().bases.clone();
            if bases.fetch_now(&id) {
                landed(&o, &id);
            }
        });
    }
}

/// A base is here: the table again, and the arcana window's Terrorblade after it.
fn landed(o: &Arc<Owner>, id: &str) {
    drop(o.refresh_schema_in_background());
    if id != TERRORBLADE_BASE {
        return;
    }
    // after the table, not on top of it
    o.settled();
    let mut lines: Vec<String> = Vec::new();
    {
        let mut core = o.core();
        let c = &mut *core;
        let ids: Vec<String> = c
            .library
            .list()
            .iter()
            .filter(|r| r.get("generated").and_then(|g| g.get("mode")).and_then(Value::as_str) == Some("mod"))
            .filter_map(|r| r.get("id").map(crate::js::string))
            .collect();
        let game = c.game();
        let bases = c.bases.clone();
        c.kept.arcana(&game).rebuild(&c.installer, &mut c.library, &ids, Some(&*bases), &mut |m| lines.push(m));
    }
    for l in lines {
        o.diag(&l);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_base_not_on_disk_is_not_here_and_one_on_disk_is_read_without_the_fetchers_lock() {
        let ud = std::env::temp_dir().join(format!("mm-owner-bases-{}", uuid::Uuid::new_v4().simple()));
        let log = Arc::new(crate::app_log::AppLog::new(&ud));
        let bases = OwnerBases::new(&ud, Arc::new(Net::new(crate::net_fetch::now_ms)), crate::net_fetch::now_ms, log);
        assert!(bases.entries("x").is_none());
        // a base all here: its blob, and the ready list naming it
        let data = b"one file of the base".to_vec();
        let sha = crate::arcana_base_store::blob_sha(&data);
        std::fs::create_dir_all(ud.join("arcana-bases").join("blobs")).unwrap();
        std::fs::write(ud.join("arcana-bases").join("blobs").join(&sha), &data).unwrap();
        let ready = serde_json::json!({ "x": { "models/a.vmdl_c": sha } });
        std::fs::write(ud.join("arcana-bases").join("ready.json"), ready.to_string()).unwrap();
        let held = bases.fetcher.lock().unwrap();
        let got = bases.entries("x").expect("on disk");
        drop(held);
        assert_eq!(got.len(), 1);
        // not attached to an owner: a wish is dropped, nothing is fetched
        bases.want("y");
        let _ = std::fs::remove_dir_all(ud);
    }
}
