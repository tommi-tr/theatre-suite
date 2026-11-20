//! Keeps Windows awake while Cue is open: no sleep and no screen saver in the middle of a show
//! (13_cue.md, "Affidabilità"). Nothing is changed in the system settings: the request lasts as long
//! as the thread that made it and ends with Cue. On other systems this is a no-op.

/// `on = true`: system and display required until further notice; `false`: back to normal.
/// Call it from the main thread (the request belongs to the thread that makes it).
#[cfg(windows)]
pub fn keep_awake(on: bool) {
    use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
    let flags = if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED } else { ES_CONTINUOUS };
    // SAFETY: plain Win32 call with constant flags; it only records a request for this thread.
    unsafe {
        SetThreadExecutionState(flags);
    }
}

#[cfg(not(windows))]
pub fn keep_awake(_on: bool) {}
