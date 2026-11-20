import type { Host } from "./host";
import type { ReactNode } from "react";
import { CinemaIcon, FullScreenIcon, PopoutIcon } from "./lyssna/toolbar-icons";

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

export function playbarViewButtons(host: Host, onFullscreen: (event: MouseEvent) => void, onPopout: (() => void) | undefined, onCinema: () => void) {
  const fullscreen = viewButton(host, "Lyssna Lyrics fullscreen", <FullScreenIcon />, onFullscreen);
  const { button } = fullscreen;
  button.classList.add("lyssna-playbar-fullscreen");
  button.title += " (Shift for cinema)";
  const popout = onPopout && viewButton(host, "Pop out lyrics", <PopoutIcon />, onPopout);
  const cinema = viewButton(host, "Cinema Lyrics Window", <CinemaIcon />, onCinema);

  function placeBefore(control: HTMLButtonElement | undefined, anchor: HTMLElement, show: boolean) {
    if (!control) return;
    if (!show || !anchor.isConnected) {
      control.remove();
      return;
    }
    if (control.style.order !== anchor.style.order) control.style.order = anchor.style.order;
    if (anchor.previousElementSibling !== control) anchor.before(control);
  }

  return {
    sync(showPopout: boolean, showCinema: boolean) {
      const legacy = document.getElementById("LyssnaLyrics_FullscreenButton");
      if (legacy) button.remove();
      else if (!button.isConnected || !button.previousElementSibling?.matches(nativeSelector)) {
        const controls = document.querySelector(controlsSelector);
        const native = controls?.querySelector(nativeSelector) ??
          document.querySelector(`[data-testid="now-playing-bar"] ${nativeSelector}`);
        if (native) native.after(button);
        else if (controls && button.parentElement !== controls) controls.append(button);
      }
      const anchor = legacy ?? button;
      // Keep the hidden native fullscreen button adjacent to its replacement.
      const previous = anchor.previousElementSibling;
      const before = previous instanceof HTMLElement && previous.matches(nativeSelector) ? previous : anchor;
      const legacyPopout = document.getElementById("LyssnaLyrics_PopupLyricsButton");
      placeBefore(popout?.button, before, showPopout && !legacyPopout);
      const cinemaAnchor = legacyPopout ?? (popout?.button.isConnected ? popout.button : before);
      placeBefore(cinema.button, cinemaAnchor, showCinema && !document.getElementById("LyssnaLyrics_ExternalCinemaButton"));
    },
    setPopoutActive(active: boolean) { popout?.button.setAttribute("aria-pressed", String(active)); },
    setCinemaActive(active: boolean) { cinema.button.setAttribute("aria-pressed", String(active)); },
    dispose() {
      popout?.dispose();
      cinema.dispose();
      fullscreen.dispose();
    },
  };
}
