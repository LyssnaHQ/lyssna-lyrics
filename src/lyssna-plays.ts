import { useEffect, useRef } from "react";
import type { Host } from "./host";
import { sendLyssnaExternalPlay, sendLyssnaPlay } from "./lyssna-api";
import type { Lyrics } from "./lyssna/types";
import { hasLyssnaSession, lyssnaAccess } from "./lyssna-account";

let currentTrack: string | undefined;
let playbackId: string | undefined;
let reported = false;

function syncListen(host: Host) {
  const track = host.track()?.id;
  const playback = host.playbackId();
  if (track !== currentTrack || (playback && playbackId && playback !== playbackId)) {
    reported = false;
    playbackId = undefined;
  }
  currentTrack = track;
  playbackId = playback || playbackId;
}

export function trackLyssnaListens(host: Host) {
  syncListen(host);
  return host.watchControls(() => syncListen(host));
}

export function useLyssnaPlay(host: Host, trackId: string, songId: string | undefined, external: Lyrics["external"], playing: boolean, view: Window) {
  const externalId = external?.id;
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const area = marker.current?.closest<HTMLElement>(".lyrics-body, .lyssna-now-playing-lines, .lyrics-popout-lyrics");
    if (!area || (!songId && !externalId) || !playing) return;
    let visible = false;
    const report = () => {
      if (!visible || view.document.hidden || !host.playing() || !area.isConnected ||
        area.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) === false) return;
      syncListen(host);
      if (reported || currentTrack !== trackId) return;
      reported = true;
      const listen = playbackId;
      // lyrics from outside Lyssna have no song: the play is counted for the install
      if (!songId) {
        if (externalId) sendLyssnaExternalPlay("apple_music", externalId);
        return;
      }
      if (hasLyssnaSession()) void lyssnaAccess().then((token) => {
        syncListen(host);
        if (currentTrack === trackId && playbackId === listen && visible && host.playing() && !view.document.hidden && area.isConnected &&
          area.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) !== false) {
          sendLyssnaPlay(songId, token);
        }
      }).catch(() => {});
      else sendLyssnaPlay(songId);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting && entry.intersectionRatio > 0;
      report();
    });
    observer.observe(area);
    view.document.addEventListener("visibilitychange", report);
    const stop = host.watchControls(report);
    return () => {
      visible = false;
      observer.disconnect();
      view.document.removeEventListener("visibilitychange", report);
      stop();
    };
  }, [host, trackId, songId, externalId, playing, view]);
  return marker;
}
