use crate::config::RestartPolicy;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub struct CrashDecision {
    pub delay: Duration,
    pub crash_loop: bool,
    pub crashes_in_window: usize,
}

#[derive(Debug)]
pub struct CrashTracker {
    policy: RestartPolicy,
    consecutive_failures: u32,
    crashes: VecDeque<Instant>,
}

impl CrashTracker {
    pub fn new(policy: RestartPolicy) -> Self {
        Self {
            policy,
            consecutive_failures: 0,
            crashes: VecDeque::new(),
        }
    }

    pub fn record_exit(&mut self, started_at: Instant, now: Instant) -> CrashDecision {
        let runtime = now.saturating_duration_since(started_at);
        if runtime >= Duration::from_millis(self.policy.stable_reset_ms) {
            self.consecutive_failures = 0;
            self.crashes.clear();
        }

        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        self.crashes.push_back(now);
        let cutoff = now
            .checked_sub(Duration::from_millis(self.policy.crash_window_ms))
            .unwrap_or(now);
        while self.crashes.front().is_some_and(|instant| *instant < cutoff) {
            self.crashes.pop_front();
        }

        let crash_loop = self.crashes.len() >= self.policy.maximum_crashes_in_window;
        let exponent = self.consecutive_failures.saturating_sub(1).min(30);
        let exponential = self
            .policy
            .initial_delay_ms
            .saturating_mul(1_u64 << exponent)
            .min(self.policy.maximum_delay_ms);
        let delay = if crash_loop {
            self.policy.crash_loop_quarantine_ms
        } else {
            exponential
        };
        CrashDecision {
            delay: Duration::from_millis(delay),
            crash_loop,
            crashes_in_window: self.crashes.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> RestartPolicy {
        RestartPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 8_000,
            stable_reset_ms: 60_000,
            crash_window_ms: 300_000,
            maximum_crashes_in_window: 3,
            crash_loop_quarantine_ms: 120_000,
        }
    }

    #[test]
    fn applies_exponential_cap_and_crash_loop_quarantine() {
        let start = Instant::now();
        let mut tracker = CrashTracker::new(policy());
        assert_eq!(tracker.record_exit(start, start).delay, Duration::from_secs(1));
        assert_eq!(tracker.record_exit(start, start).delay, Duration::from_secs(2));
        let third = tracker.record_exit(start, start);
        assert!(third.crash_loop);
        assert_eq!(third.delay, Duration::from_secs(120));
    }

    #[test]
    fn stable_runtime_resets_backoff() {
        let start = Instant::now();
        let mut tracker = CrashTracker::new(policy());
        tracker.record_exit(start, start);
        let later = start + Duration::from_secs(61);
        assert_eq!(tracker.record_exit(start, later).delay, Duration::from_secs(1));
    }
}
