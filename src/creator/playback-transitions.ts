import { useEffect } from "react";
import type { Host } from "../host";

const names = ["audioCrossfade", "autoMix"] as const;
const recoveryKey = (name: typeof names[number]) => `lyssna-lyrics.creator-playback.${name}`;
let pending = Promise.resolve();

function saved(key: string) {
  try { return sessionStorage.getItem(key) === "true"; } catch { return false; }
}

function remember(key: string, restore: boolean) {
  try {
    if (restore) sessionStorage.setItem(key, "true");
    else sessionStorage.removeItem(key);
  } catch { /* Normal close still restores the in-memory value. */ }
}

export function useCreatorPlaybackTransitions(host: Host, enabled: boolean) {
  useEffect(() => {
    let closed = false;
    const changed = new Set<typeof names[number]>();
    function apply(active: boolean) {
      pending = pending.then(async () => {
        if (active && closed) return;
        for (const name of names) {
          const control = host.playbackTransition(name);
          if (!control) continue;
          const key = recoveryKey(name);
          try {
            if (active) {
              if (!await control.getValue() || closed) continue;
              changed.add(name);
              remember(key, true);
              await control.setValue(false);
            } else if (changed.has(name) || saved(key)) {
              if (!await control.getValue()) await control.setValue(true);
              remember(key, false);
            }
          } catch { /* Keep the recovery marker if Spotify could not restore the setting. */ }
        }
      });
    }
    if (!enabled) return;
    apply(true);
    const restore = () => {
      if (closed) return;
      closed = true;
      apply(false);
    };
    window.addEventListener("pagehide", restore, { once: true });
    return () => {
      window.removeEventListener("pagehide", restore);
      restore();
    };
  }, [host, enabled]);
}

export function restoreCreatorPlaybackTransitions(host: Host) {
  pending = pending.then(async () => {
    for (const name of names) {
      const key = recoveryKey(name);
      if (!saved(key)) continue;
      const control = host.playbackTransition(name);
      if (!control) continue;
      try {
        if (!await control.getValue()) await control.setValue(true);
        remember(key, false);
      } catch { /* Retry recovery on the next launch. */ }
    }
  });
}
