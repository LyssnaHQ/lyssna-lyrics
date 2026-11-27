const nativeControls = [
  'button:is([data-testid="control-button-npv"], [data-testid="control-button-queue"], [data-testid="cover-art-button"])',
  'button:is([data-restore-focus-key="now_playing_view"], [data-restore-focus-key="queue"], [data-restore-focus-key="buddy_feed"])',
  'button:is([data-restore-focus-key="device_picker"], [data-restore-focus-key="dodo_device_picker"])',
  'button:is([data-restore-focus-key="birdhouse"], [data-restore-focus-key="messaging"], [data-restore-focus-key="edit_transition"])',
  'button:is([aria-label="Friend Activity" i], [aria-label="Connect to a device" i], [aria-label="Show Now Playing view" i])',
  'button[data-spotify-plus-disable-peek="true"]',
].join(", ");

const hiddenPanel = '[hidden], [inert], [aria-hidden="true"], .Root__right-sidebar-collapsed, [data-spotify-plus-peek-hidden="true"]';

function activePanel(sidebar: HTMLElement | null) {
  // Read Spotify's panel state from its markup even while Review covers the native slot.
  const panels = sidebar?.querySelectorAll<HTMLElement>('aside[aria-label], #Desktop_PanelContainer_Id, [role="complementary"][aria-label]');
  return panels && Array.from(panels).find(element => !element.closest(hiddenPanel));
}

export function watchNativeSidebar(close: () => void) {
  let sidebar: HTMLElement | null = null;
  let previous: string | undefined;
  let initial = true;
  const check = () => {
    const panel = activePanel(sidebar);
    const active = panel?.getAttribute("aria-label") ?? panel?.id;
    const opened = !initial && active && active !== previous;
    previous = active;
    initial = false;
    if (opened) close();
  };
  const observer = new MutationObserver(check);
  const choosePanel = (event: MouseEvent) => {
    const target = event.composedPath()[0];
    if (event.defaultPrevented || !(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(nativeControls);
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true" ||
      button.dataset.spotifyPlusDevicePickerProxy === "true") return;
    const panel = activePanel(sidebar);
    const coverOpensCurrentPanel = button.dataset.testid === "cover-art-button" &&
      (panel?.matches('.NowPlayingView, [aria-label="Now playing view" i]') ||
        panel?.querySelector('[data-testid="NPV_Panel_OpenDiv"]'));
    // If this toggle already owns the hidden native slot, reveal it without toggling it off.
    if (panel && (coverOpensCurrentPanel || button.matches('[aria-pressed="true"], [data-active="true"]'))) {
      event.preventDefault();
      event.stopPropagation();
    }
    close();
  };
  window.addEventListener("click", choosePanel, true);
  return {
    sync(next: HTMLElement | null) {
      if (sidebar !== next) {
        observer.disconnect();
        sidebar = next;
        if (sidebar) observer.observe(sidebar, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "aria-label", "aria-hidden", "inert", "hidden", "data-spotify-plus-peek-hidden"],
        });
      }
      check();
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener("click", choosePanel, true);
    },
  };
}
