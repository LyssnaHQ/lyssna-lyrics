import { useLayoutEffect, useState } from "react";
import creatorCss from "./ttml-creator.css?inline";
import playbarCss from "./playbar.css?inline";

const centerSelector = ".main-nowPlayingBar-center, [data-npb-secondary]:has([data-testid='player-controls'])";
const rightSelector = ".main-nowPlayingBar-right, [data-npb-secondary]:has(.main-nowPlayingBar-extraControls, .now-playing-bar-extra-controls)";

export function useCreatorPlaybar(view: Window & typeof globalThis, open: boolean, reduceMotion: boolean) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setTarget(null);
      return;
    }

    const { document } = view;
    const dock = document.createElement("div");
    dock.className = "lyssna-creator-playbar";
    const shadow = dock.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${creatorCss}\n${playbarCss}`;
    const slot = document.createElement("div");
    slot.className = "creator-playbar-slot";
    shadow.append(style, slot);

    let center: Element | null = null;
    let right: Element | null = null;
    function sync() {
      const fullscreen = document.fullscreenElement;
      if (dock.isConnected && dock.parentElement === center?.parentElement && dock.parentElement === right?.parentElement &&
        (!fullscreen || fullscreen.contains(dock))) return;

      const playbar = document.querySelector("[data-testid='now-playing-bar'], .Root__now-playing-bar");
      center = playbar?.querySelector(centerSelector) ?? null;
      right = playbar?.querySelector(rightSelector) ?? null;
      const row = center?.parentElement;
      if (!center || !row || right?.parentElement !== row || (fullscreen && !fullscreen.contains(row))) {
        dock.remove();
        setTarget(null);
        return;
      }
      center.before(dock);
      setTarget(slot);
    }

    sync();
    const observer = new view.MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("fullscreenchange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", sync);
      dock.remove();
    };
  }, [view, open]);
  useLayoutEffect(() => {
    target?.classList.toggle("reduce-motion", reduceMotion);
  }, [target, reduceMotion]);
  return target;
}
