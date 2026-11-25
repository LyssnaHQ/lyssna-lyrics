import { useEffect, useState } from "react";
import type { Host, Track } from "./host";
import { accountChanged, hasLyssnaSession } from "./lyssna-account";
import { markLyssnaInstrumental } from "./lyssna-provider";

export function InstrumentalAction({ track, host, notify }: {
  track: Track; host: Host; notify(message: string, error?: boolean): void;
}) {
  const [signedIn, setSignedIn] = useState(hasLyssnaSession);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    const update = () => setSignedIn(hasLyssnaSession());
    window.addEventListener(accountChanged, update);
    update();
    return () => window.removeEventListener(accountChanged, update);
  }, []);
  if (track.local || !signedIn) return null;
  return <button type="button" disabled={busy || submitted} onClick={async () => {
    setBusy(true);
    try {
      notify(await markLyssnaInstrumental(track, host));
      setSubmitted(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t update instrumental status.", true);
    } finally { setBusy(false); }
  }}>{busy ? "Saving…" : "Mark as instrumental"}</button>;
}
