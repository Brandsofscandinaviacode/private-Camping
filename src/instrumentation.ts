// Instrumentation hook — runs once per server process on startup.
// Used here to kick off the shower-session sweep so paused sessions
// auto-resume and expired sessions auto-close without external cron.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startShowerScheduler } = await import("./lib/shower-scheduler");
  startShowerScheduler();
}
