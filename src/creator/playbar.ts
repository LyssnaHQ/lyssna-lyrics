import { useLayoutEffect, useState } from "react";
import creatorCss from "./ttml-creator.css?inline";

export type CreatorPlaybarSlots = {
  wave: HTMLElement;
  speed?: HTMLElement;
  play?: HTMLElement;
  spectrogram?: HTMLElement;
};

export function useCreatorPlaybar(view: Window & typeof globalThis, open: boolean, reduceMotion: boolean) {
  const [slots, setSlots] = useState<CreatorPlaybarSlots>();
  useLayoutEffect(() => {
    if (!open) { setSlots(undefined); return; }
    const { document } = view;
    const dock = document.createElement("div");
    dock.className = "lyssna-editor-dock";
    const shadow = dock.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = creatorCss;
    const wave = document.createElement("div");
    wave.className = "lyssna-editor-wave-slot";
    shadow.append(style, wave);

    const speed = document.createElement("div");
    speed.className = "lyssna-editor-speed-slot";
    const play = document.createElement("div");
    play.className = "lyssna-editor-play-slot";
    let previous: CreatorPlaybarSlots | undefined;

    function sync() {
      const bar = document.querySelector<HTMLElement>('[data-testid="now-playing-bar"], .Root__now-playing-bar');
      const controls = bar?.querySelector<HTMLElement>('[data-testid="player-controls"], .player-controls');
      const center = controls?.closest<HTMLElement>(".main-nowPlayingBar-center, [data-npb-secondary]") ?? controls?.parentElement;
      const fullscreen = document.fullscreenElement;
      if (!bar || !controls || !center || (fullscreen && !fullscreen.contains(bar))) {
        dock.remove();
        speed.remove();
        play.remove();
        if (previous) setSlots(previous = undefined);
        return;
      }
      if (dock.parentElement !== center) center.append(dock);
      const widget = bar.querySelector<HTMLElement>(
        '[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"], .main-nowPlayingWidget-nowPlaying',
      );
      if (widget && speed.parentElement !== widget) widget.append(speed);
      if (!widget) speed.remove();
      const nativePlay = controls.querySelector('[data-testid="control-button-playpause"]');
      if (nativePlay && nativePlay.previousElementSibling !== play) nativePlay.before(play);
      if (!nativePlay) play.remove();
      const next = {
        wave,
        speed: widget ? speed : undefined,
        play: nativePlay ? play : undefined,
        spectrogram: bar.querySelector<HTMLElement>(".lyssna-editor-spectrogram-slot") ?? undefined,
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
  }, [view, open]);
  useLayoutEffect(() => {
    slots?.wave.classList.toggle("reduce-motion", reduceMotion);
  }, [slots, reduceMotion]);
  return slots;
}
