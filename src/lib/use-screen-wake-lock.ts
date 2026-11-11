import { useEffect } from "react";

type WakeLockSentinelLike = { released: boolean; release(): Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };

export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined") return;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;

    const request = async () => {
      if (document.visibilityState !== "visible" || sentinel && !sentinel.released) return;
      try { sentinel = await wakeLock.request("screen"); }
      catch { /* The browser can reject while hidden; visibility changes retry the request. */ }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") void request();
      else if (sentinel && !sentinel.released) {
        const released = sentinel;
        sentinel = null;
        void released.release().catch(() => undefined); // Releasing during page cleanup is best effort.
      }
    };

    document.addEventListener("visibilitychange", visibilityChanged);
    void request();
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    };
  }, [active]);
}
