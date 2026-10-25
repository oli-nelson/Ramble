//! Pure, bounded authorization gate for a single user-requested OS paste gesture.
//! No clipboard reads, platform input calls or retries live here.
use std::time::Duration;

pub const TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Foreground {
    Ramble,
    Target,
    Other,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Wait,
    PasteOnce,
    Cancel,
}

#[derive(Default)]
pub struct PasteGate {
    target_seen: bool,
    finished: bool,
}

impl PasteGate {
    pub fn poll(
        &mut self,
        elapsed: Duration,
        current: bool,
        target_alive: bool,
        foreground: Foreground,
        keys_released: bool,
    ) -> Step {
        if self.finished
            || !current
            || !target_alive
            || elapsed >= TIMEOUT
            || foreground == Foreground::Other
            || (self.target_seen && foreground != Foreground::Target)
        {
            self.finished = true;
            return Step::Cancel;
        }
        if foreground == Foreground::Target {
            // Require a second confirmed target poll after activation, not merely
            // a successful activation request. Shift/Command/Ctrl/Enter must be up.
            if self.target_seen && keys_released {
                self.finished = true;
                return Step::PasteOnce;
            }
            self.target_seen = true;
        }
        Step::Wait
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const TICK: Duration = Duration::from_millis(25);

    #[test]
    fn waits_for_confirmed_focus_and_released_keys_then_authorizes_exactly_once() {
        let mut gate = PasteGate::default();
        assert_eq!(
            gate.poll(TICK, true, true, Foreground::Ramble, false),
            Step::Wait
        );
        assert_eq!(
            gate.poll(TICK, true, true, Foreground::Target, false),
            Step::Wait
        );
        assert_eq!(
            gate.poll(TICK, true, true, Foreground::Target, false),
            Step::Wait
        );
        assert_eq!(
            gate.poll(TICK, true, true, Foreground::Target, true),
            Step::PasteOnce
        );
        assert_eq!(
            gate.poll(TICK, true, true, Foreground::Target, true),
            Step::Cancel
        );
    }

    #[test]
    fn missing_target_timeout_resummon_and_unrelated_focus_cancel_without_paste() {
        for (time, current, alive, foreground) in [
            (TIMEOUT, true, true, Foreground::Target),
            (TICK, false, true, Foreground::Target),
            (TICK, true, false, Foreground::Target),
            (TICK, true, true, Foreground::Other),
        ] {
            let mut gate = PasteGate::default();
            assert_eq!(
                gate.poll(time, current, alive, foreground, true),
                Step::Cancel
            );
            assert_eq!(
                gate.poll(TICK, true, true, Foreground::Target, true),
                Step::Cancel
            );
        }
    }

    #[test]
    fn focus_loss_after_activation_never_pastes_even_if_the_target_returns() {
        for foreground in [Foreground::Ramble, Foreground::Other] {
            let mut gate = PasteGate::default();
            assert_eq!(
                gate.poll(TICK, true, true, Foreground::Target, false),
                Step::Wait
            );
            assert_eq!(gate.poll(TICK, true, true, foreground, true), Step::Cancel);
            assert_eq!(
                gate.poll(TICK, true, true, Foreground::Target, true),
                Step::Cancel
            );
        }
    }
}
