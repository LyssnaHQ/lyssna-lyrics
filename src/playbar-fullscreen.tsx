import type { Host } from "./host";
import { FullScreenIcon } from "./lyssna/toolbar-icons";

const nativeSelector = 'button[data-testid="fullscreen-mode-button"]';
const controlsSelector = ".main-nowPlayingBar-extraControls";

export function playbarFullscreen(host: Host, onClick: (event: MouseEvent) => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lyssna-playbar-fullscreen";
  button.title = "Lyssna Lyrics fullscreen (Shift for cinema)";
  button.setAttribute("aria-label", "Lyssna Lyrics fullscreen");
  button.addEventListener("click", onClick);
  const icon = host.mount(button);
  icon.render(<FullScreenIcon />);

  return {
    sync() {
      if (document.getElementById("LyssnaLyrics_FullscreenButton")) {
        button.remove();
        return;
      }
      if (button.isConnected && button.previousElementSibling?.matches(nativeSelector)) return;
      const controls = document.querySelector(controlsSelector);
      const native = controls?.querySelector(nativeSelector) ??
        document.querySelector(`[data-testid="now-playing-bar"] ${nativeSelector}`);
      if (native) native.after(button);
      else if (controls && button.parentElement !== controls) controls.append(button);
    },
    dispose() {
      button.removeEventListener("click", onClick);
      icon.unmount();
      button.remove();
    },
  };
}
