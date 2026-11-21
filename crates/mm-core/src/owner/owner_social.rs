//! Likes on catalog mods and follows of their authors (catalog/social.rs), for the window.
//!
//! Every call reaches the service off the lock: the lock is held only to copy the service's
//! address out of the remote config and the client out of Core.

use serde_json::{json, Value};

use crate::owner::{arg, Owner, R};

pub const CHANNELS: &[&str] = &["social:state", "social:mark"];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| answer(o, channel, args))
}

/// The service's address when the config names one, and the client.
pub fn service(o: &Owner) -> (Option<String>, std::sync::Arc<crate::social::Social>) {
    let c = o.core();
    (c.remote.cloud_api(), c.social.clone())
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> R {
    let (api, social) = service(o);
    match channel {
        "social:state" => Ok(social.snapshot(api.as_deref())),
        "social:mark" => {
            let Some(api) = api else {
                return Ok(json!({ "error": crate::i18n::t("Лайки пока выключены", &[]) }));
            };
            let kind =
                crate::social::Kind::parse(arg(args, 0).as_str().unwrap_or("")).ok_or("expected like or follow")?;
            let name = crate::js::string(&arg(args, 1));
            let on = arg(args, 2) == Value::Bool(true);
            Ok(social.mark(&api, kind, &name, on).unwrap_or_else(|e| json!({ "error": e })))
        }
        other => Err(format!("no handler for {other}")),
    }
}
