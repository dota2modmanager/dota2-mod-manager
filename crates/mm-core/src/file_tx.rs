//! All of it, or none of it: the writes of one change to the game folder, each recording how to undo
//! itself before it is taken, in memory and in a journal on the disk, so a failure or a killed
//! process puts the folder back. Replacing src/file-tx.ts and src/file-tx-journal.ts, which tell
//! why each step is shaped the way it is.
//!
//! The journal is the TypeScript one, line for line: a journal left by either is recovered by the
//! other.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// A step about to be taken, and how to take it back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "what", rename_all = "lowercase")]
pub enum Undo {
    Unwrite { dest: String, parked: Option<String> },
    Unmove { from: String, to: String, parked: Option<String> },
    Unremove { target: String, parked: String },
    Rmdir { dir: String },
}

/// The journal's own extension.
pub const JOURNAL_EXT: &str = ".txlog";

/// Is anything at this path, a dangling link included.
fn there(p: &str) -> bool {
    fs::symlink_metadata(p).is_ok()
}

/// fs.rmSync(p, { recursive: true, force: true }).
fn rm_rf(p: &str) -> std::io::Result<()> {
    match fs::symlink_metadata(p) {
        Err(_) => Ok(()),
        Ok(m) if m.is_dir() => fs::remove_dir_all(p),
        Ok(_) => fs::remove_file(p),
    }
}

/// Take one step back; answers what it could not bring back.
pub fn undo_step(op: &Undo) -> std::io::Result<Option<String>> {
    match op {
        Undo::Unwrite { dest, parked: None } => rm_rf(dest)?,
        Undo::Unwrite { dest, parked: Some(parked) } => {
            if !there(parked) {
                return Ok((!there(dest)).then(|| format!("{dest} is gone, and so is its parked copy")));
            }
            rm_rf(dest)?;
            fs::rename(parked, dest)?;
        }
        Undo::Unmove { from, to, parked } => {
            if there(to) && !there(from) {
                fs::rename(to, from)?;
            }
            if let Some(parked) = parked.as_deref().filter(|p| there(p) && !there(to)) {
                fs::rename(parked, to)?;
            }
        }
        Undo::Unremove { target, parked } => {
            if there(target) {
                return Ok(None);
            }
            if !there(parked) {
                return Ok(Some(format!("{target} is gone, and so is its parked copy")));
            }
            fs::rename(parked, target)?;
        }
        Undo::Rmdir { dir } => {
            let _ = fs::remove_dir(dir); // not empty, or not there: not ours to delete
        }
    }
    Ok(None)
}

/// Where a step parked an original, if it did.
pub fn parked_by(op: &Undo) -> Option<&str> {
    match op {
        Undo::Unwrite { parked, .. } | Undo::Unmove { parked, .. } => parked.as_deref(),
        Undo::Unremove { parked, .. } => Some(parked),
        Undo::Rmdir { .. } => None,
    }
}

/// One transaction's journal: opened on its first step, so a change that takes none leaves no file.
pub struct Journal {
    pub file: PathBuf,
    fd: Option<fs::File>,
}

impl Journal {
    pub fn new(file: PathBuf) -> Journal {
        Journal { file, fd: None }
    }

    /// Append one line, and make sure it is on the disk before the step it describes is taken.
    pub fn add(&mut self, entry: &Value) -> std::io::Result<()> {
        if self.fd.is_none() {
            if let Some(dir) = self.file.parent() {
                fs::create_dir_all(dir)?;
            }
            self.fd = Some(fs::OpenOptions::new().append(true).create(true).open(&self.file)?);
        }
        let fd = self.fd.as_mut().expect("opened above");
        fd.write_all(format!("{}\n", crate::js::stringify(entry, "")).as_bytes())?;
        fd.sync_all()
    }

    /// Done with it: nothing is left to recover.
    pub fn close(&mut self) {
        self.fd = None;
        let _ = fs::remove_file(&self.file);
    }
}

fn undo_value(op: &Undo) -> Value {
    serde_json::to_value(op).unwrap_or(Value::Null)
}

/// A line read back as a step, with the TypeScript's checks: every path a non-empty string.
fn as_undo(e: &Value) -> Option<Undo> {
    let o = e.as_object()?;
    let str_ = |k: &str| o.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
    let parked = |k: &str| match o.get(k) {
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) if !s.is_empty() => Some(Some(s.clone())),
        _ => None,
    };
    Some(match o.get("what").and_then(Value::as_str)? {
        "unwrite" => Undo::Unwrite { dest: str_("dest")?, parked: parked("parked")? },
        "unmove" => Undo::Unmove { from: str_("from")?, to: str_("to")?, parked: parked("parked")? },
        "unremove" => Undo::Unremove { target: str_("target")?, parked: str_("parked")? },
        "rmdir" => Undo::Rmdir { dir: str_("dir")? },
        _ => return None,
    })
}

/// What a journal says: its steps in order, and whether the change got as far as committing.
/// Reading stops at the first line that is not whole.
pub fn read_journal(file: &Path) -> std::io::Result<(Vec<Undo>, bool)> {
    let text = String::from_utf8_lossy(&fs::read(file)?).into_owned();
    let (mut steps, mut committed) = (Vec::new(), false);
    for line in text.split('\n') {
        if crate::js::trim(line).is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else { break };
        if entry.get("commit") == Some(&Value::Bool(true)) {
            committed = true;
        } else if let Some(op) = as_undo(&entry) {
            steps.push(op);
        } else {
            break;
        }
    }
    Ok((steps, committed))
}

/// What recovery did: changes undone and changes finished.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Recovered {
    pub undone: usize,
    pub finished: usize,
}

/// Finish whatever a killed process left in `dir`: a committed change drops what it parked, an
/// unfinished one is undone from its last step to its first. The journal goes either way.
pub fn recover_journals(dir: Option<&Path>, log: &mut dyn FnMut(String)) -> Recovered {
    let mut out = Recovered::default();
    let Some(dir) = dir else { return out };
    let Ok(read) = fs::read_dir(dir) else { return out };
    let mut names: Vec<String> = read
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
        .filter(|n| n.ends_with(JOURNAL_EXT))
        .collect();
    names.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    for name in names.iter().rev() {
        let file = dir.join(name);
        let (steps, committed) = match read_journal(&file) {
            Ok(r) => r,
            Err(e) => {
                log(format!("tx recovery: unreadable {name}: {e}"));
                continue;
            }
        };
        if committed {
            for parked in steps.iter().filter_map(parked_by) {
                if let Err(e) = rm_rf(parked) {
                    log(format!("tx recovery: leftover {parked}: {e}"));
                }
            }
            out.finished += 1;
        } else {
            for op in steps.iter().rev() {
                match undo_step(op) {
                    Ok(Some(lost)) => log(format!("tx recovery: {lost}")),
                    Ok(None) => {}
                    Err(e) => log(format!("tx recovery: could not undo {} in {name}: {e}", what(op))),
                }
            }
            out.undone += 1;
        }
        let _ = fs::remove_file(&file);
    }
    out
}

fn what(op: &Undo) -> &'static str {
    match op {
        Undo::Unwrite { .. } => "unwrite",
        Undo::Unmove { .. } => "unmove",
        Undo::Unremove { .. } => "unremove",
        Undo::Rmdir { .. } => "rmdir",
    }
}

fn where_(op: &Undo) -> &str {
    match op {
        Undo::Unwrite { dest, .. } => dest,
        Undo::Unremove { target, .. } => target,
        Undo::Unmove { to, .. } => to,
        Undo::Rmdir { dir } => dir,
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn base36(mut n: u64) -> String {
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// path.resolve(dir) for a path already absolute or relative to the working folder.
fn absolute(p: &Path) -> PathBuf {
    std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf())
}

/// One change to the folder. Library writes join it by being handed it (src/library.ts joined the
/// open one); a rollback leaves the caller to read its own state back.
pub struct FileTx {
    pub id: String,
    pub undo: Vec<Undo>,
    pub staged: Vec<String>,
    pub done: bool,
    journal: Option<Journal>,
    parked: u64,
    log: Box<dyn FnMut(String)>,
}

impl FileTx {
    /// `journal_dir`: where its journal goes, or none (a unit test not about crashes).
    pub fn new(journal_dir: Option<&Path>, log: Box<dyn FnMut(String)>) -> FileTx {
        let now =
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        let id = format!("{}{}", base36(now), base36(COUNTER.fetch_add(1, Ordering::Relaxed)));
        let journal = journal_dir.map(|d| Journal::new(d.join(format!("{id}{JOURNAL_EXT}"))));
        FileTx { id, undo: Vec::new(), staged: Vec::new(), done: false, journal, parked: 0, log }
    }

    fn staged_name(&mut self, target: &str) -> String {
        let n = self.parked;
        self.parked += 1;
        format!("{target}.{}-{}.mmtx", self.id, base36(n))
    }

    /// Record a step's undo, in memory and in the journal, before the step is taken.
    fn record(&mut self, op: Undo) -> std::io::Result<()> {
        if let Some(j) = self.journal.as_mut() {
            j.add(&undo_value(&op))?;
        }
        if let Some(p) = parked_by(&op).filter(|_| !matches!(op, Undo::Rmdir { .. })) {
            self.staged.push(p.to_string());
        }
        self.undo.push(op);
        Ok(())
    }

    /// Create every missing folder on the way to a file, remembering which ones are ours.
    fn ensure_dir(&mut self, dir: &Path) -> std::io::Result<()> {
        let mut made: Vec<PathBuf> = Vec::new();
        let mut cur = absolute(dir);
        while !cur.exists() {
            made.insert(0, cur.clone());
            match cur.parent() {
                Some(up) if up != cur => cur = up.to_path_buf(),
                _ => break,
            }
        }
        if made.is_empty() {
            return Ok(());
        }
        for d in made {
            self.record(Undo::Rmdir { dir: path_str(&d) })?;
        }
        fs::create_dir_all(dir)
    }

    fn parking_for(&mut self, target: &str) -> Option<String> {
        Path::new(target).exists().then(|| self.staged_name(target))
    }

    fn displace(target: &str, parked: Option<&str>) -> std::io::Result<()> {
        match parked {
            Some(p) => fs::rename(target, p),
            None => Ok(()),
        }
    }

    /// Write a file, over an existing one or not.
    pub fn write(&mut self, dest: &Path, buf: &[u8]) -> std::io::Result<PathBuf> {
        self.ensure_dir(dest.parent().unwrap_or(Path::new(".")))?;
        let d = path_str(dest);
        let parked = self.parking_for(&d);
        self.record(Undo::Unwrite { dest: d.clone(), parked: parked.clone() })?;
        Self::displace(&d, parked.as_deref())?;
        // dest is empty now, so the write creates it and fails rather than writes over something
        // that appeared in between
        fs::OpenOptions::new().write(true).create_new(true).open(dest)?.write_all(buf)?;
        Ok(dest.to_path_buf())
    }

    /// Copy a file in, over an existing one or not.
    pub fn copy(&mut self, src: &Path, dest: &Path) -> std::io::Result<PathBuf> {
        self.ensure_dir(dest.parent().unwrap_or(Path::new(".")))?;
        let d = path_str(dest);
        let parked = self.parking_for(&d);
        self.record(Undo::Unwrite { dest: d.clone(), parked: parked.clone() })?;
        Self::displace(&d, parked.as_deref())?;
        let mut from = fs::File::open(src)?;
        let mut to = fs::OpenOptions::new().write(true).create_new(true).open(dest)?;
        std::io::copy(&mut from, &mut to)?;
        Ok(dest.to_path_buf())
    }

    /// Rename, which is how a mod is switched on and off.
    pub fn rename(&mut self, from: &Path, to: &Path) -> std::io::Result<PathBuf> {
        if !from.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("ENOENT: no such file or directory, rename '{}' -> '{}'", from.display(), to.display()),
            ));
        }
        self.ensure_dir(to.parent().unwrap_or(Path::new(".")))?;
        let t = path_str(to);
        let parked = self.parking_for(&t);
        self.record(Undo::Unmove { from: path_str(from), to: t.clone(), parked: parked.clone() })?;
        Self::displace(&t, parked.as_deref())?;
        fs::rename(from, to)?;
        Ok(to.to_path_buf())
    }

    /// Delete a file or a whole folder. Nothing is actually gone until commit.
    pub fn remove(&mut self, target: &Path) -> std::io::Result<bool> {
        if !target.exists() {
            return Ok(false);
        }
        let t = path_str(target);
        let parked = self.staged_name(&t);
        self.record(Undo::Unremove { target: t.clone(), parked: parked.clone() })?;
        Self::displace(&t, Some(&parked))?;
        Ok(true)
    }

    /// Everything worked: drop the displaced originals and stop being undoable.
    pub fn commit(&mut self) {
        if self.done {
            return;
        }
        self.done = true;
        if let Some(j) = self.journal.as_mut() {
            let _ = j.add(&serde_json::json!({ "commit": true }));
        }
        for parked in std::mem::take(&mut self.staged) {
            if let Err(e) = rm_rf(&parked) {
                (self.log)(format!("tx {}: leftover {parked}: {e}", self.id));
            }
        }
        if let Some(j) = self.journal.as_mut() {
            j.close();
        }
        self.undo.clear();
    }

    /// Undo the steps after `mark`, newest first.
    pub fn undo_to(&mut self, mark: usize) {
        while self.undo.len() > mark {
            let op = self.undo.pop().expect("longer than mark");
            match undo_step(&op) {
                Ok(Some(lost)) => (self.log)(format!("tx {}: {lost}", self.id)),
                Ok(None) => {}
                Err(e) => (self.log)(format!("tx {}: could not undo {} {}: {e}", self.id, what(&op), where_(&op))),
            }
        }
    }

    /// Put the folder back the way it was, best effort: a step that cannot be undone is logged.
    pub fn rollback(&mut self) {
        if self.done {
            return;
        }
        self.done = true;
        self.undo_to(0);
        if let Some(j) = self.journal.as_mut() {
            j.close();
        }
        self.staged.clear();
    }

    /// Run a block as one change: it commits when the block returns Ok and rolls back on Err.
    pub fn run<T, E>(
        journal_dir: Option<&Path>,
        log: Box<dyn FnMut(String)>,
        body: impl FnOnce(&mut FileTx) -> Result<T, E>,
    ) -> Result<T, E> {
        let mut tx = FileTx::new(journal_dir, log);
        match body(&mut tx) {
            Ok(out) => {
                tx.commit();
                Ok(out)
            }
            Err(e) => {
                tx.rollback();
                Err(e)
            }
        }
    }

    /// A block inside this change: if it fails, its own steps are undone before the error goes on.
    pub fn savepoint<T, E>(&mut self, body: impl FnOnce(&mut FileTx) -> Result<T, E>) -> Result<T, E> {
        let mark = self.undo.len();
        let out = body(self);
        if out.is_err() {
            self.undo_to(mark);
        }
        out
    }
}

/// Copy a file into place: through the change when there is one, directly when not.
pub fn copy_into(src: &Path, dest: &Path, tx: Option<&mut FileTx>) -> std::io::Result<()> {
    if let Some(tx) = tx {
        return tx.copy(src, dest).map(|_| ());
    }
    if let Some(d) = dest.parent() {
        fs::create_dir_all(d)?;
    }
    fs::copy(src, dest).map(|_| ())
}

/// Write bytes into place: through the change when there is one, directly when not.
pub fn write_into(buf: &[u8], dest: &Path, tx: Option<&mut FileTx>) -> std::io::Result<()> {
    if let Some(tx) = tx {
        return tx.write(dest, buf).map(|_| ());
    }
    if let Some(d) = dest.parent() {
        fs::create_dir_all(d)?;
    }
    fs::write(dest, buf)
}
