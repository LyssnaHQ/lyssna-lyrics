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

const reviewWidthKey = "lyssna-lyrics.review-sidebar-width";
const minReviewWidth = 230;
const maxReviewWidth = 600;

export function resizeReviewSidebar(sidebar: HTMLElement, panelId: string) {
  const handle = document.createElement("div");
  handle.className = "review-resize-handle";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", "Resize Review sidebar");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-controls", panelId);

  let preferred: number | undefined;
  try {
    const saved = Number(localStorage.getItem(reviewWidthKey));
    if (Number.isFinite(saved) && saved > 0) preferred = saved;
  } catch { /* Storage may be unavailable. */ }

  let floating = false;
  let width = 0;
  let min = minReviewWidth;
  let max = maxReviewWidth;
  let drag: { pointerId: number; startX: number; startWidth: number; direction: number; preferred?: number } | undefined;
  const direction = () => getComputedStyle(sidebar).direction === "rtl" ? -1 : 1;
  const fit = (size: number) => Math.round(Math.min(max, Math.max(min, size)));
  const apply = (size: number) => {
    if (width === size) return;
    width = size;
    sidebar.style.setProperty("--lyssna-review-width", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuetext", `${width} pixels`);
  };
  const syncWidth = () => {
    const available = floating ? window.innerWidth - 16 : Math.floor(window.innerWidth * 0.55);
    max = Math.max(1, Math.min(maxReviewWidth, available));
    min = Math.min(minReviewWidth, max);
    const defaultWidth = floating ? 420 : Math.min(420, window.innerWidth * 0.31);
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    apply(fit(preferred ?? defaultWidth));
  };
  const save = () => {
    if (preferred === undefined) return;
    try { localStorage.setItem(reviewWidthKey, String(preferred)); }
    catch { /* Width still applies to the open panel. */ }
  };
  const change = (size: number) => {
    const next = fit(size);
    if (next === width) return false;
    preferred = next;
    apply(next);
    return true;
  };

  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, direction: direction(), preferred };
    handle.dataset.resizing = "";
  });
  handle.addEventListener("pointermove", event => {
    if (drag?.pointerId !== event.pointerId) return;
    change(drag.startWidth + (drag.startX - event.clientX) * drag.direction);
  });
  const finish = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (event.type === "pointercancel") {
      preferred = drag.preferred;
      syncWidth();
    } else {
      if (event.type === "pointerup") change(drag.startWidth + (drag.startX - event.clientX) * drag.direction);
      if (preferred !== drag.preferred) save();
    }
    drag = undefined;
    delete handle.dataset.resizing;
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  handle.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = width + 16 * direction(); break;
      case "ArrowRight": next = width - 16 * direction(); break;
      case "Home": next = min; break;
      case "End": next = max; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (change(next)) save();
  });
  window.addEventListener("resize", syncWidth);
  syncWidth();

  return {
    handle,
    place(nextFloating: boolean) {
      if (floating === nextFloating) return;
      floating = nextFloating;
      syncWidth();
    },
    dispose() {
      window.removeEventListener("resize", syncWidth);
      if (drag) save();
    },
  };
}
