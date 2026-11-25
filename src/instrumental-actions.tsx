import { useEffect, useState } from "react";
import type { Host, Track } from "./host";
import { accountChanged, hasLyssnaSession, readLyssnaProfile } from "./lyssna-account";
import { markLyssnaInstrumental } from "./lyssna-provider";
import { canReview } from "./creator/review-api";

export function InstrumentalAction({ track, host, marked, notify }: {
  track: Track; host: Host; marked: boolean; notify(message: string, error?: boolean): void;
}) {
  const [signedIn, setSignedIn] = useState(hasLyssnaSession);
  const [canUnmark, setCanUnmark] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const update = () => {
      const current = ++revision;
      const signed = hasLyssnaSession();
      setSignedIn(signed);
      setCanUnmark(false);
      if (signed && marked) void readLyssnaProfile().then(profile => {
        if (!active || current !== revision) return;
        setCanUnmark(canReview(profile?.role) || profile?.tier?.toLowerCase() === "trusted");
      }).catch(() => {});
    };
    update();
    window.addEventListener(accountChanged, update);
    return () => { active = false; window.removeEventListener(accountChanged, update); };
  }, [marked]);
  if (track.local || !signedIn || (marked && !canUnmark)) return null;
  return <button type="button" disabled={busy || submitted} onClick={async () => {
    setBusy(true);
    try {
      notify(await markLyssnaInstrumental(track, host, marked));
      setSubmitted(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn’t update instrumental status.", true);
    } finally { setBusy(false); }
  }}>{busy ? "Saving…" : marked ? "Unmark instrumental" : "Mark as instrumental"}</button>;
}
