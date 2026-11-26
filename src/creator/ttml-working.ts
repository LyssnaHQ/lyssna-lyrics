import { useEffect, useMemo, useState } from "react";
import { loadDraft } from "./ttml-saves";
import { type CreatorLine, toLyrics } from "./ttml-creator-model";
import type { Lyrics } from "./types";

// Songs whose draft was edited in the TTML Creator this session. Their
// timed draft shows on the Lyrics page until the user picks the original.
const working = new Set<string>();
const dismissed = new Map<string, "main" | "all">();

export function markWorking(uri: string) {
  working.add(uri);
  if (dismissed.delete(uri)) window.dispatchEvent(new CustomEvent(liveDraftChanged, { detail: uri }));
}

export function forgetWorking(uri: string) {
  working.delete(uri);
}

export function dismissDraft(uri: string, everywhere = false) {
  if (everywhere || !dismissed.has(uri)) dismissed.set(uri, everywhere ? "all" : "main");
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

// The lines open in the TTML Creator, saved or not, so a song with nothing
// drafted yet still previews as a draft.
const live = new Map<string, CreatorLine[]>();
export const liveDraftChanged = "lyssna-lyrics:live-draft-changed";

export function showLive(uri: string, lines: CreatorLine[]) {
  if (live.get(uri) === (lines.length ? lines : undefined)) return;
  if (lines.length) live.set(uri, lines);
  else live.delete(uri);
  window.dispatchEvent(new CustomEvent(liveDraftChanged, { detail: uri }));
}

export function dismissSubmittedDraft(uri: string, lines: CreatorLine[]) {
  if (live.get(uri) !== lines) return false;
  dismissDraft(uri, true);
  return true;
}

function draftPreview(uri: string | undefined, detached: boolean): Lyrics | null {
  if (!uri || dismissed.get(uri) === "all" || (!detached && (!shown || dismissed.has(uri)))) return null;
  const lines =
    live.get(uri) ?? (working.has(uri) ? loadDraft(uri)?.lines : undefined);
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
