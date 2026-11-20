import { useEffect } from "react";
import type { Host, Track } from "../host";

const sessions = new WeakMap<Host, symbol>();
const pendingRestores = new WeakMap<Host, Promise<void>>();

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

export function useCreatorRepeat(host: Host, notify: (message: string, error?: boolean) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const session = Symbol();
    const previousRestore = pendingRestores.get(host);
    const ownsSession = () => sessions.get(host) === session;
    let open = true;
    let prepared: Promise<void> | undefined;
    let stopWaiting: (() => void) | undefined;
    let restoreRepeat: (() => Promise<void>) | undefined;
    let restoreContext: (() => Promise<void>) | undefined;

    async function prepare(track: Track, previousRepeat: ReturnType<Host["repeat"]>) {
      if (previousRepeat === "track") return;
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
        restoreRepeat = async () => {
          if (host.repeat() === "track") await host.setRepeat(previousRepeat);
        };
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
        try { await restoreRepeat?.(); } catch { /* Spotify can reject the old mode. */ }
        if (ownsSession()) await restoreContext?.();
      }).catch(() => {}).finally(() => {
        if (ownsSession()) sessions.delete(host);
        if (pendingRestores.get(host) === restored) pendingRestores.delete(host);
      });
      pendingRestores.set(host, restored);
    };
  }, [host, notify, enabled]);
}
