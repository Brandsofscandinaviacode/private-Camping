// Background scheduler for shower sessions — auto-resume pauses after 5 min
// and close expired sessions at the 5 s cadence the user requested.
//
// This module is intended to be imported once from instrumentation.ts at
// server startup. A module-level guard ensures we never register more than
// one interval (e.g. under HMR reloads).
//
// The sweep itself delegates to `checkShowerSessions` in `@/lib/actions`.

import { logger } from "./logger";

type Timer = ReturnType<typeof setInterval>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalStore = globalThis as any;

const SWEEP_INTERVAL_MS = 5_000;

export function startShowerScheduler() {
  if (globalStore.__showerSchedulerStarted) return;
  globalStore.__showerSchedulerStarted = true;

  let running = false;
  const tick = async () => {
    if (running) return; // overlap protection
    running = true;
    try {
      const { checkShowerSessions } = await import("./actions");
      await checkShowerSessions();
    } catch (e) {
      logger.error("shower-scheduler", "Sweep failed", e);
    } finally {
      running = false;
    }
  };

  const timer: Timer = setInterval(tick, SWEEP_INTERVAL_MS);
  globalStore.__showerSchedulerTimer = timer;

  // Graceful shutdown
  const stop = () => {
    clearInterval(timer);
    globalStore.__showerSchedulerStarted = false;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  // Fire once immediately so the first sweep doesn't wait 5 s
  void tick();
}
