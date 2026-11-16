//! Reliability test: plays the cue list silently, several times in a row, and
//! checks that every GO does what the cue list says.
//!
//! It uses its own engine state without any audio output (the show, if there is one,
//! is not touched) and runs about twenty times faster than real time. For every
//! step it records what was expected and what happened, in codes that the
//! interface turns into plain sentences.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::core::*;
use super::model::*;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepReport {
    pub run: u32,
    pub step: u32,
    /// What was checked, as a code:
    /// `file_ok` `file_missing` `file_broken` · `go_ok` `go_wrong` · `left_ok` `left_wrong` ·
    /// `auto_ok` `auto_late` · `alive_ok` `alive_stuck` · `ended_ok` `ended_stuck` ·
    /// `loop_ok` `loop_stuck` · `stop_ok` `stop_wrong` · `empty` · `slow`.
    pub code: String,
    pub ok: bool,
    /// Number shown on the cue list.
    pub number: Option<u32>,
    pub name: Option<String>,
    /// The Exit of the track involved, for the sentence ("fadeOut" | "crossfade" | "next" | "none").
    pub exit: Option<String>,
    /// Seconds (how long it took, where it matters).
    pub seconds: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    pub runs: u32,
    pub steps: Vec<StepReport>,
    pub errors: u32,
    /// Every run behaved like the first one.
    pub identical: bool,
    pub seconds: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub run: u32,
    pub runs: u32,
    pub step: u32,
}

struct Ctx<'a> {
    st: State,
    run: u32,
    step: u32,
    steps: &'a mut Vec<StepReport>,
    numbers: HashMap<String, u32>,
    names: HashMap<String, String>,
    started: Instant,
    progress: &'a dyn Fn(Progress),
    runs: u32,
}

const BLOCK_FRAMES: usize = 480; // 10 ms at 48 kHz
const WALL_LIMIT: Duration = Duration::from_secs(150);

impl Ctx<'_> {
    fn exit_name(&self, id: &str) -> Option<String> {
        let tp = self.st.track(id)?;
        Some(
            match tp.exit {
                Some(Exit::FadeOut) => "fadeOut",
                Some(Exit::Crossfade) => "crossfade",
                Some(Exit::Next) => "next",
                None => "none",
            }
            .to_string(),
        )
    }
    fn report(&mut self, code: &str, ok: bool, id: Option<&str>, seconds: Option<f64>) {
        self.step += 1;
        let exit = id.and_then(|i| self.exit_name(i));
        self.steps.push(StepReport {
            run: self.run,
            step: self.step,
            code: code.to_string(),
            ok,
            number: id.and_then(|i| self.numbers.get(i).copied()),
            name: id.and_then(|i| self.names.get(i).cloned()),
            exit,
            seconds,
        });
        (self.progress)(Progress { run: self.run, runs: self.runs, step: self.step });
    }
    fn too_slow(&self) -> bool {
        self.started.elapsed() > WALL_LIMIT
    }
    /// Plays `secs` seconds of show time, as fast as possible.
    fn run_for(&mut self, secs: f64) {
        let mut out = vec![0f32; BLOCK_FRAMES * 2];
        let blocks = (secs * 100.0).ceil() as usize;
        for _ in 0..blocks {
            render(&mut self.st, &mut out, 2);
            serve_headless(&mut self.st);
            prepare_headless(&mut self.st);
            std::thread::sleep(Duration::from_micros(400));
            if self.too_slow() {
                break;
            }
        }
    }
    /// Plays until `done` is true, at most `limit` seconds of show time. Returns the show time used.
    fn run_until(&mut self, limit: f64, done: impl Fn(&State) -> bool) -> Option<f64> {
        let mut out = vec![0f32; BLOCK_FRAMES * 2];
        let blocks = (limit * 100.0).ceil() as usize;
        for b in 0..blocks {
            render(&mut self.st, &mut out, 2);
            serve_headless(&mut self.st);
            prepare_headless(&mut self.st);
            if done(&self.st) {
                return Some(b as f64 / 100.0);
            }
            std::thread::sleep(Duration::from_micros(400));
            if self.too_slow() {
                break;
            }
        }
        None
    }
    fn alive(&self, id: &str) -> bool {
        self.st.voices.iter().any(|v| v.track_id == id && v.alive())
    }
    fn position(&self, id: &str) -> Option<f64> {
        self.st.voices.iter().rev().find(|v| v.track_id == id && v.alive()).map(|v| v.pos)
    }
}

fn release(st: &mut State) {
    let mut all: Vec<Voice> = st.voices.drain(..).collect();
    all.extend(st.prepared.drain(..));
    all.extend(st.graveyard.drain(..));
    for v in all {
        v.h.ctl.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

fn run_once(run: u32, runs: u32, tracks: &[TrackParams], config: Config, steps: &mut Vec<StepReport>, progress: &dyn Fn(Progress)) {
    let mut st = State::new();
    st.rate = 48000;
    st.tracks = tracks.to_vec();
    st.config = Config { steps: true, ..config };
    st.status = EngineStatus { ready: true, device: "test".into(), sample_rate: 48000, error: None };
    let mut numbers = HashMap::new();
    let mut names = HashMap::new();
    let mut n = config.number_from;
    for t in tracks.iter().filter(|t| !t.hidden) {
        numbers.insert(t.id.clone(), n);
        n += 1;
        if let Some(p) = &t.path {
            names.insert(t.id.clone(), p.rsplit(['\\', '/']).next().unwrap_or(p).to_string());
        }
    }
    let mut cx = Ctx { st, run, step: 0, steps, numbers, names, started: Instant::now(), progress, runs };

    // 1) Every file is there and can be opened.
    let playable: Vec<TrackParams> = tracks.iter().filter(|t| t.playable()).cloned().collect();
    if playable.is_empty() {
        cx.report("empty", false, None, None);
        return;
    }
    for tp in &playable {
        let exists = tp.path.as_deref().map(|p| std::path::Path::new(p).is_file()).unwrap_or(false);
        if !exists {
            cx.report("file_missing", false, Some(&tp.id), None);
            continue;
        }
        match headless_voice(&cx.st, tp, tp.eff_in()) {
            Ok(v) if !v.h.ctl.failed.load(std::sync::atomic::Ordering::Relaxed) => {
                v.h.ctl.stop.store(true, std::sync::atomic::Ordering::Relaxed);
                cx.report("file_ok", true, Some(&tp.id), None);
            }
            Ok(v) => {
                v.h.ctl.stop.store(true, std::sync::atomic::Ordering::Relaxed);
                cx.report("file_broken", false, Some(&tp.id), None);
            }
            Err(_) => cx.report("file_broken", false, Some(&tp.id), None),
        }
    }

    // 2) The show, GO after GO.
    cx.st.standby = Some(playable[0].id.clone());
    prepare_headless(&mut cx.st);
    let mut need_go = true;
    for _ in 0..(playable.len() * 2 + 4) {
        if cx.too_slow() {
            cx.report("slow", false, None, Some(cx.started.elapsed().as_secs_f64()));
            break;
        }
        if need_go {
            let Some(expected) = cx.st.standby.clone() else { break };
            let before = cx.st.main.clone().filter(|m| cx.alive(m));
            let before_exit = before.as_deref().and_then(|b| cx.st.track(b).map(|t| t.exit));
            let before_loop = before.as_deref().and_then(|b| cx.st.track(b).map(|t| t.loop_on)).unwrap_or(false);
            let plan = go_headless(&mut cx.st);
            let started = matches!(&plan, Ok(GoPlan::Start(tp)) if tp.id == expected) && cx.alive(&expected) && cx.st.main.as_deref() == Some(expected.as_str());
            cx.report(if started { "go_ok" } else { "go_wrong" }, started, Some(&expected), None);
            if !started {
                break;
            }
            // The track in front leaves the way its Exit says.
            if let Some(prev) = before {
                if prev != expected {
                    cx.run_for(0.2);
                    let still = cx.st.voices.iter().find(|v| v.track_id == prev && !v.ended).map(|v| !v.stopping()).unwrap_or(false);
                    let should_stay = matches!(before_exit, Some(None)) && !before_loop && cx.st.config.others_on_go == OthersOnGo::Keep;
                    let left = !still || should_stay;
                    cx.report(if left { "left_ok" } else { "left_wrong" }, left, Some(&prev), None);
                }
            }
        }
        need_go = true;
        let Some(cur) = cx.st.main.clone() else { break };
        if cx.st.auto_start() {
            // It must start the next track by itself, at the right moment.
            let tp = cx.st.track(&cur).cloned();
            let (dur, exit_len) = match (&tp, cx.st.voices.iter().find(|v| v.track_id == cur)) {
                (Some(tp), Some(v)) => {
                    let out = tp.eff_out().map(|o| o.min(v.duration)).unwrap_or(v.duration);
                    ((out - v.pos).max(0.0), tp.exit_len(&cx.st.config))
                }
                _ => (1.0, 0.0),
            };
            let limit = dur + exit_len + 2.0;
            let cur2 = cur.clone();
            match cx.run_until(limit, |s| s.main.as_deref() != Some(cur2.as_str())) {
                Some(secs) => {
                    let next = cx.st.main.clone();
                    cx.report("auto_ok", true, next.as_deref(), Some(secs));
                    need_go = false;
                }
                None => cx.report("auto_late", false, Some(&cur), Some(limit)),
            }
        } else {
            let p0 = cx.position(&cur).unwrap_or(0.0);
            cx.run_for(1.0);
            let p1 = cx.position(&cur);
            let looping = cx.st.track(&cur).map(|t| t.loop_on).unwrap_or(false);
            let moving = match p1 {
                Some(p) => p > p0 + 0.2 || looping,
                // It may have ended on its own within the second.
                None => !cx.alive(&cur),
            };
            cx.report(if moving { "alive_ok" } else { "alive_stuck" }, moving, Some(&cur), None);
            if cx.st.standby.is_none() || cx.st.standby.as_deref() == Some(cur.as_str()) {
                // Last track: it ends by itself, or (looping) it keeps going past its end.
                let (dur, out) = cx
                    .st
                    .voices
                    .iter()
                    .find(|v| v.track_id == cur)
                    .map(|v| (v.duration, cx.st.track(&cur).and_then(|t| t.eff_out()).map(|o| o.min(v.duration)).unwrap_or(v.duration)))
                    .unwrap_or((0.0, 0.0));
                let _ = dur;
                if looping {
                    let left = (out - cx.position(&cur).unwrap_or(0.0)).max(0.0);
                    cx.run_for(left + 1.0);
                    let ok = cx.alive(&cur);
                    cx.report(if ok { "loop_ok" } else { "loop_stuck" }, ok, Some(&cur), None);
                } else {
                    let cur2 = cur.clone();
                    let gone = cx.run_until(out + 4.0, move |s| !s.voices.iter().any(|v| v.track_id == cur2 && !v.ended)).is_some();
                    cx.report(if gone { "ended_ok" } else { "ended_stuck" }, gone, Some(&cur), None);
                }
                break;
            }
        }
    }

    // 3) Stop all leaves nothing playing.
    stop_all(&mut cx.st, true);
    cx.run_for(0.2);
    let quiet = cx.st.voices.is_empty();
    cx.report(if quiet { "stop_ok" } else { "stop_wrong" }, quiet, None, None);
    release(&mut cx.st);
}

/// Runs the whole test: `runs` times in a row.
pub fn run(tracks: Vec<TrackParams>, config: Config, runs: u32, progress: &dyn Fn(Progress)) -> TestReport {
    let t0 = Instant::now();
    let runs = runs.clamp(1, 10);
    let mut steps: Vec<StepReport> = Vec::new();
    for r in 1..=runs {
        run_once(r, runs, &tracks, config, &mut steps, progress);
    }
    // Every run must behave like the first (same checks, same results).
    let shape = |r: u32| -> Vec<(String, bool, Option<u32>)> { steps.iter().filter(|s| s.run == r).map(|s| (s.code.clone(), s.ok, s.number)).collect() };
    let first = shape(1);
    let identical = (2..=runs).all(|r| shape(r) == first);
    let errors = steps.iter().filter(|s| !s.ok).count() as u32;
    TestReport { runs, steps, errors, identical, seconds: t0.elapsed().as_secs_f64() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, path: &str) -> TrackParams {
        serde_json::from_value(serde_json::json!({ "id": id, "path": path })).unwrap()
    }
    fn wav(name: &str, secs: f32) -> String {
        let dir = std::env::temp_dir().join(format!("diaframma-selftest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join(name);
        if !wav.exists() {
            crate::audio::decode::tests::write_wav(&wav, 44100, secs);
        }
        wav.to_string_lossy().to_string()
    }

    #[test]
    fn a_good_show_passes_every_run_and_a_missing_file_is_reported() {
        let p = wav("s.wav", 1.5);
        let mut a = track("A", &p);
        a.exit = Some(Exit::Crossfade);
        a.entry = Some(Entry::FadeIn);
        let mut b = track("B", &p);
        b.exit = Some(Exit::FadeOut);
        let c = track("C", &p);
        let rep = run(vec![a.clone(), b.clone(), c.clone()], Config { crossfade_sec: 0.3, fade_out_sec: 0.3, fade_in_sec: 0.2, ..Default::default() }, 2, &|_| {});
        assert_eq!(rep.errors, 0, "{:#?}", rep.steps.iter().filter(|s| !s.ok).collect::<Vec<_>>());
        assert!(rep.identical);
        assert!(rep.steps.iter().any(|s| s.code == "auto_ok"), "A crossfades into B by itself");
        assert!(rep.steps.iter().any(|s| s.code == "ended_ok"));
        assert!(rep.steps.last().map(|s| s.code == "stop_ok").unwrap_or(false));

        let mut gone = c.clone();
        gone.path = Some("/definitely/not/here.wav".into());
        let rep = run(vec![a, b, gone], Config::default(), 1, &|_| {});
        assert!(rep.errors > 0);
        assert!(rep.steps.iter().any(|s| s.code == "file_missing" && s.number == Some(3)));
    }
}
