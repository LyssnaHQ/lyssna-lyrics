import type { Host } from "./host";
import type { ReactNode } from "react";
import { FullScreenIcon, PopoutIcon } from "./lyssna/toolbar-icons";

const nativeSelector = 'button[data-testid="fullscreen-mode-button"]';
const controlsSelector = ".main-nowPlayingBar-extraControls";

function viewButton(host: Host, label: string, icon: ReactNode, onClick: (event: MouseEvent) => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lyssna-playbar-view-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  const root = host.mount(button);
  root.render(icon);
  return { button, dispose() {
    button.removeEventListener("click", onClick);
    root.unmount();
    button.remove();
  } };
}

export function playbarViewButtons(host: Host, onFullscreen: (event: MouseEvent) => void, onPopout?: () => void) {
  const fullscreen = viewButton(host, "Lyssna Lyrics fullscreen", <FullScreenIcon />, onFullscreen);
  const { button } = fullscreen;
  button.classList.add("lyssna-playbar-fullscreen");
  button.title += " (Shift for cinema)";
  const popout = onPopout && viewButton(host, "Pop out lyrics", <PopoutIcon />, onPopout);

  return {
    sync(showPopout: boolean) {
      const legacy = document.getElementById("LyssnaLyrics_FullscreenButton");
      if (legacy) button.remove();
      else if (!button.isConnected || !button.previousElementSibling?.matches(nativeSelector)) {
        const controls = document.querySelector(controlsSelector);
        const native = controls?.querySelector(nativeSelector) ??
          document.querySelector(`[data-testid="now-playing-bar"] ${nativeSelector}`);
        if (native) native.after(button);
        else if (controls && button.parentElement !== controls) controls.append(button);
      }
      if (!popout) return;
      const anchor = legacy ?? button;
      if (!showPopout || !anchor.isConnected || document.getElementById("LyssnaLyrics_PopupLyricsButton")) {
        popout.button.remove();
      } else {
        const order = anchor.style.order;
        if (popout.button.style.order !== order) popout.button.style.order = order;
        if (anchor.nextElementSibling !== popout.button) anchor.after(popout.button);
      }
    },
    setPopoutActive(active: boolean) { popout?.button.setAttribute("aria-pressed", String(active)); },
    dispose() {
      popout?.dispose();
      fullscreen.dispose();
    },
  };
}
