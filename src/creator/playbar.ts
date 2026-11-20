import { useLayoutEffect, useRef, useState } from "react";
import type { Host } from "../host";
import { clock } from "../playback";
import type { CreatorPlayback } from "./surface";
import creatorCss from "./ttml-creator.css?inline";
import meterCss from "./recording-meter.css?inline";

export type CreatorPlaybarSlots = {
  wave?: HTMLElement;
  speed?: HTMLElement;
  play?: HTMLElement;
  spectrogram?: HTMLElement;
};

const playbarSelector = '[data-testid="now-playing-bar"], .Root__now-playing-bar';
const playSelector = '[data-testid="control-button-playpause"]';

export function useCreatorPlaybar(view: Window & typeof globalThis, open: boolean, reduceMotion: boolean, previewing: boolean) {
  const [slots, setSlots] = useState<CreatorPlaybarSlots>();
  useLayoutEffect(() => {
    if (!open) { setSlots(undefined); return; }
    const { document } = view;
    const dock = document.createElement("div");
    dock.className = "lyssna-editor-dock";
    const shadow = dock.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${creatorCss}\n${meterCss}`;
    const wave = document.createElement("div");
    wave.className = "lyssna-editor-wave-slot";
    shadow.append(style, wave);

    const speed = document.createElement("div");
    speed.className = "lyssna-editor-speed-slot";
    const play = document.createElement("div");
    play.className = "lyssna-editor-play-slot";
    let previous: CreatorPlaybarSlots | undefined;

    function sync() {
      const bar = document.querySelector<HTMLElement>(playbarSelector);
      const controls = bar?.querySelector<HTMLElement>('[data-testid="player-controls"], .player-controls');
      const center = controls?.closest<HTMLElement>(".main-nowPlayingBar-center, [data-npb-secondary]") ?? controls?.parentElement;
      const fullscreen = document.fullscreenElement;
      if (!bar || (!previewing && !center) || (fullscreen && !fullscreen.contains(bar))) {
        dock.remove();
        speed.remove();
        play.remove();
        if (previous) setSlots(previous = undefined);
        return;
      }
      if (!previewing && center && dock.parentElement !== center) center.append(dock);
      const widget = bar.querySelector<HTMLElement>(
        '[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"], .main-nowPlayingWidget-nowPlaying',
      );
      if (widget && speed.parentElement !== widget) widget.append(speed);
      if (!widget) speed.remove();
      const nativePlay = previewing ? null : controls?.querySelector(playSelector);
      if (nativePlay && nativePlay.previousElementSibling !== play) nativePlay.before(play);
      if (!nativePlay) play.remove();
      const next = {
        wave: previewing ? undefined : wave,
        speed: widget ? speed : undefined,
        play: nativePlay ? play : undefined,
        spectrogram: previewing ? undefined : bar.querySelector<HTMLElement>(".lyssna-editor-spectrogram-slot") ?? undefined,
      };
      if (!previous || previous.speed !== next.speed || previous.play !== next.play || previous.spectrogram !== next.spectrogram) {
        setSlots(previous = next);
      }
    }

    sync();
    const observer = new view.MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("fullscreenchange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", sync);
      dock.remove();
      speed.remove();
      play.remove();
    };
  }, [view, open, previewing]);
  useLayoutEffect(() => {
    slots?.wave?.classList.toggle("reduce-motion", reduceMotion);
  }, [slots, reduceMotion]);
  return slots;
}

/** Keep Spotify's transport in place while it controls audio played by the draft preview. */
export function usePreviewTransport(view: Window & typeof globalThis, host: Host, playback: CreatorPlayback | undefined, onSpotifyResume: () => void) {
  const latest = useRef(playback);
  latest.current = playback;
  const trackId = playback?.trackId;
  useLayoutEffect(() => {
    if (!trackId) return;
    const { document } = view;
    let nativePosition = host.position();
    let nativePlaying = host.playing();
    let button: HTMLButtonElement | undefined;
    let playLabel: string | null = null;
    let progress: HTMLElement | undefined;
    let elapsed: HTMLElement | undefined;

    function clearButton() {
      if (!button || !button.hasAttribute("data-lyssna-preview-playing")) return;
      button.removeAttribute("data-lyssna-preview-playing");
      if (!host.playing() && button.getAttribute("aria-label") === "Pause") {
        if (playLabel === null) button.removeAttribute("aria-label");
        else button.setAttribute("aria-label", playLabel);
      }
    }
    function paint() {
      const local = latest.current;
      if (!local || host.playing()) { clearButton(); return; }
      if (!button?.isConnected || !progress?.isConnected || !elapsed?.isConnected) {
        const bar = document.querySelector(playbarSelector);
        const nextButton = bar?.querySelector<HTMLButtonElement>(playSelector) ?? undefined;
        if (nextButton !== button) {
          clearButton();
          button = nextButton;
          playLabel = button?.getAttribute("aria-label") ?? null;
        }
        const nextProgress = bar?.querySelector<HTMLElement>('[data-testid="playback-progressbar"] .progress-bar') ?? undefined;
        if (nextProgress !== progress) {
          progress?.style.removeProperty("--lyssna-preview-progress");
          progress = nextProgress;
        }
        const nextElapsed = bar?.querySelector<HTMLElement>('[data-testid="playback-position"]') ?? undefined;
        if (nextElapsed !== elapsed) {
          if (elapsed) delete elapsed.dataset.lyssnaPreviewTime;
          elapsed = nextElapsed;
        }
      }
      if (local.playing && button && !button.hasAttribute("data-lyssna-preview-playing")) {
        button.setAttribute("data-lyssna-preview-playing", "");
        button.setAttribute("aria-label", "Pause");
      } else if (!local.playing) clearButton();
      const duration = host.duration();
      const position = Math.min(local.read(), duration || Infinity);
      progress?.style.setProperty("--lyssna-preview-progress", `${(position / Math.max(duration, 1)) * 100}%`);
      const time = clock(position);
      if (elapsed && elapsed.dataset.lyssnaPreviewTime !== time) elapsed.dataset.lyssnaPreviewTime = time;
    }
    const unwatch = host.watchControls(() => {
      if (host.track()?.id !== trackId) return;
      const playing = host.playing();
      const position = host.position();
      if (playing && !nativePlaying) onSpotifyResume();
      else if (!playing && Math.abs(nativePosition - position) >= 50) latest.current?.seek(position);
      nativePosition = position;
      nativePlaying = playing;
      paint();
    });
    function toggle(event: MouseEvent) {
      const target = event.target;
      if (!latest.current || host.track()?.id !== trackId || !(target instanceof view.Element) ||
        !target.closest(playSelector)?.closest(playbarSelector)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      latest.current.toggle();
    }
    document.addEventListener("click", toggle, true);
    paint();
    const timer = view.setInterval(paint, 100);
    return () => {
      unwatch();
      document.removeEventListener("click", toggle, true);
      view.clearInterval(timer);
      clearButton();
      progress?.style.removeProperty("--lyssna-preview-progress");
      if (elapsed) delete elapsed.dataset.lyssnaPreviewTime;
    };
  }, [host, trackId, view, onSpotifyResume]);
}
