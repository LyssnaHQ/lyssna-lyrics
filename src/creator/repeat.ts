import { useEffect } from "react";
import type { Host, Track } from "../host";

const sessions = new WeakMap<Host, symbol>();
const pendingRestores = new WeakMap<Host, Promise<void>>();
const repeatRecoveryKey = "lyssna-lyrics.v1.creator-repeat";
type RepeatChange = { previous: "off" | "context"; token: string };

function savedRepeatChange(): string | null {
  try { return sessionStorage.getItem(repeatRecoveryKey); }
  catch { return null; }
}

function rememberRepeat(previous: RepeatChange["previous"]): RepeatChange {
  const token = `${previous}:${crypto.randomUUID()}`;
  // Save before asking Spotify to change modes so a reload can recover an interrupted request.
  try { sessionStorage.setItem(repeatRecoveryKey, token); }
  catch { /* The editor can still restore the mode when it closes normally. */ }
  return { previous, token };
}

function waitForPlayer(host: Host, ready: () => boolean, timeout: number): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let unwatch: (() => void) | undefined;
    let finished = false;
    const timer = window.setTimeout(() => finish(ready()), timeout);
    unwatch = host.watchControls(() => { if (ready()) finish(true); });
    function finish(result: boolean) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      unwatch?.();
      resolve(result);
    }
    if (finished) unwatch();
    else if (ready()) finish(true);
  });
}

async function restoreRepeat(host: Host, change: RepeatChange) {
  const saved = savedRepeatChange();
  if (saved && saved !== change.token) return;
  if (host.repeat() === "track") {
    await host.setRepeat(change.previous);
    await waitForPlayer(host, () => host.repeat() !== "track", 700);
  }
  if (host.repeat() !== "track" && savedRepeatChange() === change.token) {
    try { sessionStorage.removeItem(repeatRecoveryKey); }
    catch { /* A later startup can discard the completed recovery. */ }
  }
}

export function startCreatorRepeatRecovery(host: Host) {
  const token = savedRepeatChange();
  const previous = token?.split(":")[0];
  if (!token || (previous !== "off" && previous !== "context")) return () => {};
  let stopped = false;
  let markReady: () => void;
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  const restored = ready.then(async () => {
    if (stopped || savedRepeatChange() !== token) return;
    // Spotify can publish the saved repeat mode shortly after it restores the track.
    await waitForPlayer(host, () => host.repeat() === "track", 700);
    if (!stopped && savedRepeatChange() === token) await restoreRepeat(host, { previous, token });
  }).catch(() => {
    // Preserve the saved mode if Spotify rejects the recovery.
  }).finally(() => {
    if (pendingRestores.get(host) === restored) pendingRestores.delete(host);
  });
  pendingRestores.set(host, restored);

  let unwatch: (() => void) | undefined;
  function stopWatching() {
    unwatch?.();
    unwatch = undefined;
  }
  function onState() {
    if (!host.track() || host.djNarrating()) return;
    stopWatching();
    markReady();
  }
  unwatch = host.watchControls(onState);
  onState();
  return () => {
    stopped = true;
    stopWatching();
    markReady();
  };
}

export function useCreatorRepeat(host: Host, notify: (message: string, error?: boolean) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const session = Symbol();
    const previousRestore = pendingRestores.get(host);
    const ownsSession = () => sessions.get(host) === session;
    let open = true;
    let prepared: Promise<void> | undefined;
    let stopWaiting: (() => void) | undefined;
    let repeatChange: RepeatChange | undefined;
    let restoreContext: (() => Promise<void>) | undefined;

    async function prepare(track: Track, previousRepeat: ReturnType<Host["repeat"]>) {
      if (previousRepeat === "track") return;
      const restoreMode = previousRepeat;
      const originalPlayback = host.playbackId();
      const originalContext = host.playbackContextUri();
      const sameTrack = () => host.track()?.id === track.id && !host.djNarrating();
      const changedTrack = () => {
        const current = host.track();
        return current !== null && current.id !== track.id;
      };
      const original = () => sameTrack() && (!originalPlayback || host.playbackId() === originalPlayback) &&
        (!originalContext || host.playbackContextUri() === originalContext);
      async function requestRepeat() {
        repeatChange ??= rememberRepeat(restoreMode);
        try { await host.setRepeat("track"); } catch { /* A blocked context can reject the command. */ }
      }

      if (!host.repeatTrackBlocked()) {
        await requestRepeat();
        await waitForPlayer(host, () => host.repeat() === "track" || !original(), 700);
      }
      if (!open || !ownsSession() || !original() || host.repeat() === "track") return;

      const uri = `spotify:track:${track.id}`;
      const previousContext = host.creatorPlaybackContext(uri);
      const wasPlaying = host.playing();
      const wasBlocked = host.repeatTrackBlocked();
      await host.playTrack(uri);
      const restarted = () => sameTrack() && (
        (!!host.playbackId() && host.playbackId() !== originalPlayback) ||
        (!!host.playbackContextUri() && host.playbackContextUri() !== originalContext) ||
        (wasBlocked && !host.repeatTrackBlocked()) || (!originalPlayback && !originalContext && !wasBlocked)
      );
      await waitForPlayer(host, () => restarted() || changedTrack(), 2_000);
      if (!sameTrack() || !ownsSession()) return;
      if (!restarted()) throw new Error("Spotify couldn’t restart this track for Repeat One.");

      const restartedPlayback = host.playbackId();
      const restartedContext = host.playbackContextUri();
      if (previousContext && (restartedPlayback || restartedContext)) restoreContext = async () => {
        if (sameTrack() && host.playbackId() === restartedPlayback && host.playbackContextUri() === restartedContext) {
          await host.restoreCreatorPlaybackContext(previousContext, host.position(), host.playing());
        }
      };
      if (!wasPlaying && host.playing()) host.toggle();
      if (!open) return;
      await requestRepeat();
      await waitForPlayer(host, () => host.repeat() === "track" || !sameTrack(), 700);
      if (open && ownsSession() && sameTrack() && host.repeat() !== "track") notify("Spotify couldn’t enable Repeat One for this track.", true);
    }

    function start() {
      const track = host.track();
      if (!open || prepared || !track || host.djNarrating()) return;
      stopWaiting?.();
      const previousRepeat = host.repeat();
      prepared = Promise.resolve().then(() => {
        if (open && ownsSession() && host.track()?.id === track.id) return prepare(track, previousRepeat);
      }).catch(() => {
        if (open && ownsSession() && host.track()?.id === track.id) notify("Spotify couldn’t restart this track for Repeat One.", true);
      });
    }
    function begin() {
      if (!open) return;
      sessions.set(host, session);
      start();
      if (!prepared) stopWaiting = host.watchControls(start);
      if (prepared) stopWaiting?.();
    }
    // A fast return to Creator must read the original repeat mode after it is restored.
    if (previousRestore) void previousRestore.then(begin);
    else begin();
    return () => {
      open = false;
      stopWaiting?.();
      const restored = Promise.resolve(previousRestore).then(() => prepared).then(async () => {
        if (!ownsSession()) return;
        try { if (repeatChange) await restoreRepeat(host, repeatChange); } catch { /* Spotify can reject the old mode. */ }
        if (ownsSession()) await restoreContext?.();
      }).catch(() => {}).finally(() => {
        if (ownsSession()) sessions.delete(host);
        if (pendingRestores.get(host) === restored) pendingRestores.delete(host);
      });
      pendingRestores.set(host, restored);
    };
  }, [host, notify, enabled]);
}
