//! MM_SHOT and MM_EVAL under Tauri (src/dev-harness.ts takeShot): the window walked to a state
//! by switches, a script run in the finished page, and its answer written beside MM_SHOT.
//!
//! tools/e2e.mjs drives every launch this way, and release.yml runs it against the installed
//! build, so the bytes people download are clicked through before they are published. A webview
//! has no capturePage, so no picture is taken: MM_SHOT names where the answers go
//! (`<shot>.eval.json`, or `<shot>.err.txt`), and e2e.mjs waits for those.
//!
//! The switches it reads: MM_VIEW, MM_CAT, MM_SEARCH, MM_CLICK, MM_SCROLL, MM_MODAL, MM_PREVIEW,
//! MM_EVAL and MM_QUIET. Pointer ones (MM_HOVER, MM_MENU, MM_DRAG, MM_WHEEL) need input events
//! a webview does not take from outside; tools/tauri-shot.mjs does those over DevTools.
//!
//! Only on a run held to a folder (--write-jail): a test, never a person's copy.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use tauri::WebviewWindow;

static STARTED: AtomicBool = AtomicBool::new(false);

/// The switches, when this run is a harnessed one.
pub struct Harness {
    shot: PathBuf,
    env: Vec<(&'static str, String)>,
    quiet: bool,
}

const SWITCHES: &[&str] =
    &["MM_VIEW", "MM_CAT", "MM_SEARCH", "MM_CLICK", "MM_SCROLL", "MM_MODAL", "MM_PREVIEW", "MM_EVAL"];

/// MM_SHOT on a jailed run; None otherwise.
pub fn wanted(jailed: bool, var: impl Fn(&str) -> Option<String>) -> Option<Harness> {
    let shot = var("MM_SHOT").filter(|s| !s.is_empty() && jailed)?;
    let env = SWITCHES.iter().filter_map(|k| var(k).filter(|v| !v.is_empty()).map(|v| (*k, v))).collect();
    Some(Harness { shot: PathBuf::from(shot), env, quiet: var("MM_QUIET").is_some() })
}

/// The page script: the steps takeShot takes, then the answer handed back to mm_shot_done.
pub fn script(h: &Harness) -> String {
    let env: serde_json::Map<String, Value> = h.env.iter().map(|(k, v)| ((*k).to_string(), json!(v))).collect();
    let eval = h.env.iter().find(|(k, _)| *k == "MM_EVAL").map(|(_, v)| v.as_str());
    // MM_EVAL is a function body, as in Electron: its own `return` is the answer
    let body = eval.map_or_else(|| "return null;".to_string(), str::to_string);
    format!(
        r#"(async () => {{
  const env = {env};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const done = (result, error) => window.__TAURI_INTERNALS__.invoke('mm_shot_done', {{ result: result === undefined ? null : JSON.stringify(result), error }});
  try {{
    if (env.MM_VIEW) {{ q(`[data-view="${{env.MM_VIEW}}"]`)?.click(); await wait(2500); }}
    if (env.MM_CAT) {{
      if (!env.MM_VIEW) {{ q(`[data-view="${{env.MM_CAT.startsWith('cosmetic:') ? 'items' : 'catalog'}}"]`)?.click(); await wait(2500); }}
      q(`.rail-item[data-cat="${{env.MM_CAT}}"]`)?.click(); await wait(2500);
    }}
    if (env.MM_SEARCH) {{
      const el = document.getElementById('globalSearch');
      if (el) {{ el.value = env.MM_SEARCH; el.dispatchEvent(new Event('input', {{ bubbles: true }})); }}
      await wait(2500);
    }}
    if (env.MM_CLICK) for (const sel of env.MM_CLICK.split('||')) {{ q(sel)?.click(); await wait(700); }}
    if (env.MM_SCROLL) {{
      const el = [...document.querySelectorAll('#main, *')].find((e) =>
        e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY));
      (el || document.scrollingElement).scrollBy(0, Number(env.MM_SCROLL) || 0); await wait(600);
    }}
    if (env.MM_MODAL) {{
      [...document.querySelectorAll('.card .card-name')].find((n) => n.textContent.trim() === env.MM_MODAL)?.closest('.card')?.click();
      await wait(1500);
      if (env.MM_PREVIEW) {{ document.getElementById('previewPlayBtn')?.click(); await wait(2500); }}
    }}
    const result = env.MM_EVAL ? await (async () => {{
{body}
    }})() : undefined;
    await done(result, null);
  }} catch (e) {{
    await done(null, String((e && e.stack) || e));
  }}
}})();"#,
        env = Value::Object(env),
    )
}

/// The page has loaded: the first time, after the seven seconds takeShot gives a page to settle,
/// the steps run in it.
pub fn loaded(h: &Harness, window: &WebviewWindow) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let (window, js, quiet) = (window.clone(), script(h), h.quiet);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(7000));
        if !quiet {
            let _ = window.show();
            let _ = window.set_focus();
        }
        if let Err(e) = window.eval(&js) {
            eprintln!("[mm-shell] harness: the page took no script ({e})");
        }
    });
}

/// The script's answer, written where e2e.mjs reads it.
pub fn done(h: &Harness, result: Option<String>, error: Option<String>) {
    let file = |ext: &str| {
        let mut p = h.shot.clone().into_os_string();
        p.push(ext);
        PathBuf::from(p)
    };
    if let Some(dir) = h.shot.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let written = match error {
        Some(e) => std::fs::write(file(".err.txt"), e),
        None => {
            let v: Value = result.as_deref().and_then(|r| serde_json::from_str(r).ok()).unwrap_or(Value::Null);
            std::fs::write(file(".eval.json"), serde_json::to_string_pretty(&v).unwrap_or_default())
        }
    };
    if let Err(e) = written {
        eprintln!("[mm-shell] harness: could not write beside {} ({e})", h.shot.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: std::collections::HashMap<String, String> =
            pairs.iter().map(|(k, v)| ((*k).into(), (*v).into())).collect();
        move |k: &str| map.get(k).cloned()
    }

    #[test]
    fn only_a_jailed_run_is_harnessed() {
        let env = vars(&[("MM_SHOT", "out/1.png"), ("MM_EVAL", "return 1;")]);
        assert!(wanted(false, &env).is_none());
        let h = wanted(true, &env).unwrap();
        assert_eq!(h.shot, PathBuf::from("out/1.png"));
        assert!(wanted(true, vars(&[("MM_EVAL", "return 1;")])).is_none());
    }

    #[test]
    fn the_script_carries_the_switches_and_the_body() {
        let h = wanted(true, vars(&[("MM_SHOT", "a.png"), ("MM_CAT", "heroes"), ("MM_EVAL", "return { ok: `x` };")]))
            .unwrap();
        let js = script(&h);
        assert!(js.contains(r#""MM_CAT":"heroes""#));
        assert!(js.contains("return { ok: `x` };"));
        assert!(js.contains("mm_shot_done"));
    }

    #[test]
    fn the_answer_lands_beside_the_shot() {
        let dir = std::env::temp_dir().join(format!("mm-harness-{}", std::process::id()));
        let h = Harness { shot: dir.join("1.png"), env: vec![], quiet: true };
        done(&h, Some(r#"{"steps":[1,2]}"#.into()), None);
        let got = std::fs::read_to_string(dir.join("1.png.eval.json")).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&got).unwrap(), json!({"steps": [1, 2]}));
        done(&h, None, Some("boom".into()));
        assert_eq!(std::fs::read_to_string(dir.join("1.png.err.txt")).unwrap(), "boom");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
