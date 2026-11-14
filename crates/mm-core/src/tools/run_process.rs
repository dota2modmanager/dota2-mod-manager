//! A program run to its end the way the main process runs Valve's tools (src/run-process.ts): its
//! output and errors read together, no console window on Windows, killed at the time limit.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// (program, arguments, its folder, variables over the app's own, a time limit in ms) to the exit
/// code and everything it printed; Err when it never ran or was killed. Fits
/// [`crate::wine::RunProcess`].
pub fn run(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
    env: &[(String, String)],
    timeout_ms: u64,
) -> Result<(i32, String), String> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("{program}: {e}"))?;
    let out = Arc::new(Mutex::new(Vec::<u8>::new()));
    let pump = |src: Option<Box<dyn Read + Send>>| {
        let out = out.clone();
        std::thread::spawn(move || {
            let Some(mut src) = src else { return };
            let mut buf = [0u8; 8192];
            while let Ok(n) = src.read(&mut buf) {
                if n == 0 {
                    break;
                }
                out.lock().unwrap_or_else(|e| e.into_inner()).extend_from_slice(&buf[..n]);
            }
        })
    };
    let a = pump(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let b = pump(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if timeout_ms > 0 && start.elapsed() > Duration::from_millis(timeout_ms) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{program}: timed out after {} s", timeout_ms / 1000));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let _ = a.join();
    let _ = b.join();
    let text = String::from_utf8_lossy(&out.lock().unwrap_or_else(|e| e.into_inner())).into_owned();
    Ok((status.code().unwrap_or(-1), text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_and_exit_code() {
        let (prog, args): (&str, Vec<String>) = if cfg!(windows) {
            ("cmd", vec!["/c".into(), "echo hi & exit 3".into()])
        } else {
            ("sh", vec!["-c".into(), "echo hi; exit 3".into()])
        };
        let (code, text) = run(prog, &args, None, &[], 10_000).unwrap();
        assert_eq!(code, 3);
        assert!(text.contains("hi"));
    }

    #[test]
    fn a_missing_program_never_ran() {
        assert!(run("no-such-program-here", &[], None, &[], 1000).is_err());
    }
}
