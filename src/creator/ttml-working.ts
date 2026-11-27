import { useEffect, useMemo, useState } from "react";
import { type CreatorLine, toLyrics } from "./ttml-creator-model";
import type { Lyrics } from "./types";

const working = new Map<string, CreatorLine[]>();
const live = new Map<string, { lines: CreatorLine[]; edited: boolean }>();
const dismissed = new Map<string, { scope: "main" | "all"; lines?: CreatorLine[] }>();
export const liveDraftChanged = "lyssna-lyrics:live-draft-changed";

export function dismissDraft(uri: string, everywhere = false) {
  const scope = everywhere || dismissed.get(uri)?.scope === "all" ? "all" : "main";
  dismissed.set(uri, { scope, lines: live.get(uri)?.lines });
  window.dispatchEvent(new CustomEvent(liveDraftChanged, { detail: uri }));
}

const SHOW_KEY = "lyssna.ttml-show-preview";

export function showsPreview() {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setShowsPreview(on: boolean) {
  try {
    localStorage.setItem(SHOW_KEY, on ? "1" : "0");
  } catch {
    // Without storage the choice lasts until Lyssna restarts.
  }
  shown = on;
  window.dispatchEvent(new Event(liveDraftChanged));
}

let shown = showsPreview();

// Detached previews follow the open editor, including its initial lyrics.
export function showLive(uri: string, lines: CreatorLine[], edited: boolean) {
  const previous = live.get(uri);
  if (previous?.lines === lines && previous.edited === edited) return;
  live.set(uri, { lines, edited });
  window.dispatchEvent(new CustomEvent(liveDraftChanged, { detail: uri }));
}

export function publishDraftPreview(uri: string, requested = false) {
  const draft = live.get(uri);
  if (!draft || (!requested && (!draft.edited || dismissed.get(uri)?.lines === draft.lines))) return;
  dismissed.delete(uri);
  if (draft.lines.length) working.set(uri, draft.lines);
  else working.delete(uri);
  window.dispatchEvent(new CustomEvent(liveDraftChanged, { detail: uri }));
}

export function dismissSubmittedDraft(uri: string, lines: CreatorLine[]) {
  if (live.get(uri)?.lines !== lines) return false;
  dismissDraft(uri, true);
  return true;
}

function draftPreview(uri: string | undefined, detached: boolean): Lyrics | null {
  if (!uri) return null;
  const dismissal = dismissed.get(uri);
  const draft = live.get(uri);
  if (!detached && (!shown || dismissal)) return null;
  if (detached && dismissal?.scope === "all" && (!draft?.edited || draft.lines === dismissal.lines)) return null;
  const lines = detached ? draft?.lines ?? working.get(uri) : working.get(uri);
  if (!lines?.length) return null;
  const lyrics = toLyrics(lines);
  return lyrics.lines.length ? lyrics : null;
}

export function useDraftPreview(uri: string | undefined, detached = false) {
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!uri) return;
    const update = (event: Event) => {
      const changed = (event as CustomEvent<string>).detail;
      if (!changed || changed === uri) refresh(previous => previous + 1);
    };
    window.addEventListener(liveDraftChanged, update);
    // The editor can publish an update before this window finishes mounting.
    refresh(previous => previous + 1);
    return () => window.removeEventListener(liveDraftChanged, update);
  }, [uri]);
  return useMemo(() => draftPreview(uri, detached), [uri, detached, revision]);
}
