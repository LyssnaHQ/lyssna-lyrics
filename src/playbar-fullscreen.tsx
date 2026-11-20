import type { Host } from "./host";
import type { ReactNode } from "react";
import { FilePenLine } from "lucide-react";
import { CinemaIcon, FullScreenIcon, PopoutIcon } from "./lyssna/toolbar-icons";
import { nativeFullscreenButton, playbarSelector } from "./playbar-controls";

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

export function playbarViewButtons(host: Host, onFullscreen: (event: MouseEvent) => void, onPopout: (() => void) | undefined,
  onCinema: () => void, onCreator: () => void) {
  const fullscreen = viewButton(host, "Lyssna Lyrics fullscreen", <FullScreenIcon />, onFullscreen);
  const { button } = fullscreen;
  button.classList.add("lyssna-playbar-fullscreen");
  button.title += " (Shift for cinema)";
  const popout = onPopout && viewButton(host, "Pop out lyrics", <PopoutIcon />, onPopout);
  const cinema = viewButton(host, "Cinema Lyrics Window", <CinemaIcon />, onCinema);
  const creator = viewButton(host, "TTML Creator", <FilePenLine size={19} />, onCreator);
  const spectrogram = document.createElement("div");
  spectrogram.className = "lyssna-editor-spectrogram-slot";

  function placeBefore(control: HTMLElement | undefined, anchor: HTMLElement, show: boolean) {
    if (!control) return;
    if (!show || !anchor.isConnected) {
      control.remove();
      return;
    }
    if (control.style.order !== anchor.style.order) control.style.order = anchor.style.order;
    if (anchor.previousElementSibling !== control) anchor.before(control);
  }

  return {
    sync(controls: HTMLElement | null, showPopout: boolean, showCinema: boolean, showCreator: boolean, creatorActive: boolean) {
      const legacy = document.getElementById("LyssnaLyrics_FullscreenButton");
      if (legacy) button.remove();
      else if (controls) {
        const native = controls.querySelector(nativeFullscreenButton)
          ?? controls.closest(playbarSelector)?.querySelector(nativeFullscreenButton);
        if (native && native.nextElementSibling !== button) native.after(button);
        else if (!native && button.parentElement !== controls) controls.append(button);
      }
      const anchor = legacy ?? button;
      // Keep the hidden native fullscreen button adjacent to its replacement.
      const previous = anchor.previousElementSibling;
      const before = previous instanceof HTMLElement && previous.matches(nativeFullscreenButton) ? previous : anchor;
      placeBefore(creator.button, before, showCreator);
      placeBefore(spectrogram, creator.button, showCreator && creatorActive);
      const pressed = String(creatorActive);
      if (creator.button.getAttribute("aria-pressed") !== pressed) creator.button.setAttribute("aria-pressed", pressed);
      const legacyPopout = document.getElementById("LyssnaLyrics_PopupLyricsButton");
      const popoutAnchor = creator.button.isConnected ? spectrogram.isConnected ? spectrogram : creator.button : before;
      placeBefore(popout?.button, popoutAnchor, showPopout && !legacyPopout);
      const cinemaAnchor = legacyPopout ?? (popout?.button.isConnected ? popout.button : popoutAnchor);
      placeBefore(cinema.button, cinemaAnchor, showCinema && !document.getElementById("LyssnaLyrics_ExternalCinemaButton"));
    },
    setPopoutActive(active: boolean) { popout?.button.setAttribute("aria-pressed", String(active)); },
    setCinemaActive(active: boolean) { cinema.button.setAttribute("aria-pressed", String(active)); },
    focusCreator() { creator.button.focus({ preventScroll: true }); },
    dispose() {
      popout?.dispose();
      cinema.dispose();
      spectrogram.remove();
      creator.dispose();
      fullscreen.dispose();
    },
  };
}
