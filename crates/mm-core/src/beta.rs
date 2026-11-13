//! The beta channel: who is let in, and which update feed this copy reads (src/beta.ts). The list
//! of testers lives in the signed config as salted sha256 hashes of Discord ids; the gate decides
//! who is offered the beta, not who is able to run it.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The channel name the updater reads for testers.
pub const BETA_CHANNEL: &str = "beta";
/// What everybody else reads.
pub const STABLE_CHANNEL: &str = "latest";

/// How an id becomes a line in the public list.
pub fn id_hash(id: &str, salt: &str) -> String {
    Sha256::digest(format!("{salt}:{}", crate::js::trim(id))).iter().map(|b| format!("{b:02x}")).collect()
}

/// Is this account on the list? A missing list, a missing id or a damaged entry all mean no.
pub fn is_tester(discord_id: Option<&str>, beta: &Value) -> bool {
    let Some(id) = discord_id.filter(|i| !i.is_empty()) else { return false };
    let Some(ids) = beta.get("ids").and_then(Value::as_array).filter(|a| !a.is_empty()) else { return false };
    let salt = beta.get("salt").map(|s| if crate::js::truthy(s) { crate::js::string(s) } else { String::new() });
    let want = id_hash(id, &salt.unwrap_or_default());
    ids.iter().any(|e| e.as_str().is_some_and(|s| s.to_lowercase() == want))
}

/// Which update channel this copy should read now: the switch alone is not enough.
pub fn channel_for(discord_id: Option<&str>, beta: &Value, wanted: bool) -> &'static str {
    if wanted && is_tester(discord_id, beta) {
        BETA_CHANNEL
    } else {
        STABLE_CHANNEL
    }
}

/// What the settings screen draws.
#[derive(Debug, Serialize)]
pub struct BetaState {
    pub eligible: bool,
    pub on: bool,
    pub channel: &'static str,
}

/// Whether to show the switch at all, and where it sits.
pub fn beta_state(discord_id: Option<&str>, beta: &Value, wanted: bool) -> BetaState {
    let eligible = is_tester(discord_id, beta);
    BetaState { eligible, on: eligible && wanted, channel: channel_for(discord_id, beta, wanted) }
}
