//! Timer resolution while a real cable is connected.
//!
//! Windows wakes sleeping threads on a ~15.6 ms tick by default: a 25 ms frame loop would
//! jitter by a whole tick. While a cable is connected (or being reconnected) Granvelo asks
//! for 1 ms with `timeBeginPeriod(1)` and gives it back with `timeEndPeriod(1)` on
//! disconnect. Since Windows 10 2004 this setting affects only this process, and Windows
//! restores it by itself when the process ends. Other systems need nothing.

#[cfg(windows)]
mod imp {
    use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};

    /// Holds the 1 ms timer resolution while alive.
    pub struct HighResTimer(());

    impl HighResTimer {
        pub fn begin() -> Option<Self> {
            // SAFETY: plain Win32 call without pointers; 0 = TIMERR_NOERROR.
            let r = unsafe { timeBeginPeriod(1) };
            (r == 0).then_some(HighResTimer(()))
        }
    }

    impl Drop for HighResTimer {
        fn drop(&mut self) {
            // SAFETY: pairs the successful timeBeginPeriod(1) of `begin`.
            unsafe {
                timeEndPeriod(1);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    /// Nothing to do: sleeps are already fine-grained.
    pub struct HighResTimer(());

    impl HighResTimer {
        pub fn begin() -> Option<Self> {
            Some(HighResTimer(()))
        }
    }
}

pub use imp::HighResTimer;
