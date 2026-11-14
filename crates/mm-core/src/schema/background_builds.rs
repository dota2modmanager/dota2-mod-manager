//! Builds of the item table in the background, one at a time (src/background-builds.ts).
//!
//! A build asked for while one runs stops that one before it writes anything, since its list of
//! picks is out of date already, and builds once more from what the library holds then; everybody
//! waiting gets the result of the build that wrote. A build run in place in between (heal, the
//! patch switch) does the same, through `ran`.
//!
//! The TypeScript interleaves a generator with the event loop. Here a build runs on one worker
//! thread and asks `stop` between its stages: true once a newer build, a build in place or Cancel
//! has taken over, and then it returns without writing.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};

/// A build: given `stop`, it answers, or returns early when `stop` says it was overtaken.
pub type Build<R> = dyn Fn(&dyn Fn() -> bool) -> R + Send + Sync;

struct Waiting<R> {
    gen: u64,
    tx: Sender<R>,
}

struct Shared<R> {
    generation: AtomicU64,
    waiting: Mutex<Vec<Waiting<R>>>,
    // builds asked for and not yet run or skipped; settled waits for it to reach zero
    queued: Mutex<usize>,
    idle: Condvar,
}

impl<R: Clone> Shared<R> {
    fn settle(&self, gen: u64, result: &R) {
        let mut w = self.waiting.lock().unwrap();
        w.retain(|x| {
            if x.gen > gen {
                return true;
            }
            let _ = x.tx.send(result.clone());
            false
        });
    }
}

/// What a build answers that the queue needs to make on its own.
pub trait Outcome: Clone + Send + 'static {
    /// The answer to everybody waiting when Cancel stopped the build.
    fn cancelled() -> Self;
}

/// Builds in the background, one at a time and in order.
pub struct BackgroundBuilds<R: Outcome> {
    shared: Arc<Shared<R>>,
    jobs: Sender<u64>,
}

impl<R: Outcome> BackgroundBuilds<R> {
    /// `build` is a build of the table; `on_end` runs once each build in the background has ended.
    pub fn new(build: Arc<Build<R>>, on_end: impl Fn() + Send + 'static) -> Self {
        let shared = Arc::new(Shared {
            generation: AtomicU64::new(0),
            waiting: Mutex::new(Vec::new()),
            queued: Mutex::new(0),
            idle: Condvar::new(),
        });
        let (jobs, rx): (Sender<u64>, Receiver<u64>) = channel();
        let s = shared.clone();
        std::thread::Builder::new()
            .name("table-builds".into())
            .spawn(move || {
                for gen in rx {
                    // a newer request is behind this one: it builds instead
                    if gen == s.generation.load(Ordering::SeqCst) {
                        let stop = || s.generation.load(Ordering::SeqCst) != gen;
                        let result = build(&stop);
                        if !stop() {
                            s.settle(gen, &result);
                        }
                        on_end();
                    }
                    let mut q = s.queued.lock().unwrap();
                    *q -= 1;
                    if *q == 0 {
                        s.idle.notify_all();
                    }
                }
            })
            .expect("the build thread starts");
        BackgroundBuilds { shared, jobs }
    }

    /// A build that ran in place, all at once: its result answers everybody waiting on an older one.
    pub fn ran(&self, result: R) -> R {
        let gen = self.shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.shared.settle(gen, &result);
        result
    }

    /// The generation a build in place should check against: `ran` after it bumps it again.
    pub fn generation(&self) -> u64 {
        self.shared.generation.load(Ordering::SeqCst)
    }

    /// A build in the background: the receiver answers once the table is written, by this build
    /// or a newer one.
    pub fn in_background(&self) -> Receiver<R> {
        let gen = self.shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = channel();
        self.shared.waiting.lock().unwrap().push(Waiting { gen, tx });
        *self.shared.queued.lock().unwrap() += 1;
        if self.jobs.send(gen).is_err() {
            // the thread is gone (a panic in a build): nobody would answer
            let mut q = self.shared.queued.lock().unwrap();
            *q -= 1;
        }
        rx
    }

    /// Stop the build in the background before it writes, and answer everybody waiting with that
    /// (issue #425). False when there was none to stop. The game keeps the table it had.
    pub fn cancel(&self) -> bool {
        if self.shared.waiting.lock().unwrap().is_empty() {
            return false;
        }
        let gen = self.shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.shared.settle(gen, &R::cancelled());
        true
    }

    /// Whether a build is running or asked for and has not answered: quitting waits.
    pub fn busy(&self) -> bool {
        !self.shared.waiting.lock().unwrap().is_empty()
    }

    /// Blocks until no build is running or asked for: the Play button waits on it.
    pub fn settled(&self) {
        let mut q = self.shared.queued.lock().unwrap();
        while *q > 0 {
            q = self.shared.idle.wait(q).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;

    #[derive(Clone, Debug, PartialEq)]
    enum R {
        Built(usize),
        Cancelled,
    }
    impl Outcome for R {
        fn cancelled() -> Self {
            R::Cancelled
        }
    }

    /// A build that counts itself, waits on `gate` before it writes, and writes `wrote`.
    fn builds(gate: Arc<(Mutex<bool>, Condvar)>, wrote: Arc<AtomicUsize>) -> BackgroundBuilds<R> {
        let n = Arc::new(AtomicUsize::new(0));
        let build: Arc<Build<R>> = Arc::new(move |stop: &dyn Fn() -> bool| {
            let k = n.fetch_add(1, Ordering::SeqCst) + 1;
            let (m, c) = &*gate;
            let mut open = m.lock().unwrap();
            while !*open && !stop() {
                open = c.wait_timeout(open, Duration::from_millis(5)).unwrap().0;
            }
            if stop() {
                return R::Built(0);
            }
            wrote.fetch_add(1, Ordering::SeqCst);
            R::Built(k)
        });
        BackgroundBuilds::new(build, || {})
    }

    fn open(gate: &Arc<(Mutex<bool>, Condvar)>) {
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
    }

    #[test]
    fn a_newer_build_stops_the_running_one_and_answers_both() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let wrote = Arc::new(AtomicUsize::new(0));
        let b = builds(gate.clone(), wrote.clone());
        let first = b.in_background();
        std::thread::sleep(Duration::from_millis(30));
        let second = b.in_background();
        let third = b.in_background();
        assert!(b.busy());
        open(&gate);
        let want = R::Built(2); // the first stopped; the second skipped for the third, which is build 2
        assert_eq!(first.recv().unwrap(), want);
        assert_eq!(second.recv().unwrap(), want);
        assert_eq!(third.recv().unwrap(), want);
        b.settled();
        assert_eq!(wrote.load(Ordering::SeqCst), 1);
        assert!(!b.busy());
    }

    #[test]
    fn a_build_in_place_answers_the_ones_waiting() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let wrote = Arc::new(AtomicUsize::new(0));
        let b = builds(gate.clone(), wrote.clone());
        let waiting = b.in_background();
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(b.ran(R::Built(99)), R::Built(99));
        assert_eq!(waiting.recv().unwrap(), R::Built(99));
        b.settled();
        assert_eq!(wrote.load(Ordering::SeqCst), 0, "the overtaken build writes nothing");
    }

    #[test]
    fn cancel_answers_with_cancelled_and_writes_nothing() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let wrote = Arc::new(AtomicUsize::new(0));
        let b = builds(gate.clone(), wrote.clone());
        assert!(!b.cancel(), "nothing to cancel");
        let waiting = b.in_background();
        std::thread::sleep(Duration::from_millis(20));
        assert!(b.cancel());
        assert_eq!(waiting.recv().unwrap(), R::Cancelled);
        b.settled();
        assert_eq!(wrote.load(Ordering::SeqCst), 0);
        assert!(!b.busy());
        // the queue goes on working after a cancel
        open(&gate);
        assert_eq!(b.in_background().recv().unwrap(), R::Built(2));
    }

    #[test]
    fn settled_returns_at_once_with_nothing_asked() {
        let gate = Arc::new((Mutex::new(true), Condvar::new()));
        let b = builds(gate, Arc::new(AtomicUsize::new(0)));
        b.settled();
        assert_eq!(b.in_background().recv().unwrap(), R::Built(1));
        b.settled();
    }
}
