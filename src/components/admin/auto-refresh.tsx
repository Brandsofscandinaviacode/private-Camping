"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the page's server data every few minutes, so a screen left open
 * at the desk keeps up with the booking sync. Only while the tab is visible,
 * and never while someone is typing or has a dialog open.
 */
export function AutoRefresh({ intervalMs = 3 * 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();

    const busy = () => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return true;
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const refreshIfDue = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < intervalMs || busy()) return;
      last = Date.now();
      router.refresh();
    };

    const timer = window.setInterval(refreshIfDue, 30_000);
    // Back on a tab that was hidden for a while: catch up straight away.
    document.addEventListener("visibilitychange", refreshIfDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfDue);
    };
  }, [router, intervalMs]);

  return null;
}
