import { ClipboardCheck } from "lucide-react";
import type { Host } from "../host";
import { accountChanged, hasLyssnaSession, readLyssnaProfile } from "../lyssna-account";
import { lyssnaInstallReady } from "../lyssna-api";
import { canReview } from "./review-api";

const controlsSelector = ".main-globalNav-contentRight, .main-topBar-topbarContentRight";
const actionRowSelector = ".main-actionButtons";
const friendsSelector = '[data-restore-focus-key="buddy_feed"], button[aria-label="Friend Activity" i]';
const bellSelector = `[data-testid="whats-new-feed-button"], button[aria-label="What's New" i], button[aria-label="Notifications" i]`;

export function reviewTopbar(host: Host, toggle: () => void, close: () => void) {
  const button = document.createElement("button");
  const label = "Review submissions";
  button.type = "button";
  button.className = "lyssna-review-topbar";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", toggle);
  const root = host.mount(button);
  root.render(<ClipboardCheck size={20} aria-hidden="true" />);

  let allowed = false;
  let pressed = false;
  let request = 0;
  const sync = (open = pressed) => {
    pressed = open;
    if (button.getAttribute("aria-pressed") !== String(open)) button.setAttribute("aria-pressed", String(open));
    if (!allowed) { button.remove(); return; }
    const nav = document.querySelector(controlsSelector) ?? document.getElementById("global-nav-bar");
    const bell = nav?.querySelector(bellSelector);
    const row = bell?.closest(actionRowSelector) ?? nav?.querySelector(actionRowSelector);
    if (row) {
      if (row.firstElementChild !== button) row.prepend(button);
    } else {
      const anchor = (bell?.closest("[data-restore-focus-key]") ?? bell) ?? nav?.querySelector(friendsSelector);
      if (anchor && anchor.previousElementSibling !== button) anchor.before(button);
    }
  };
  const updateAccess = () => {
    const id = ++request;
    const apply = (next: boolean) => {
      if (id !== request) return;
      allowed = next;
      if (!allowed && pressed) close();
      sync();
    };
    if (!hasLyssnaSession()) apply(false);
    else void readLyssnaProfile().then((profile) => {
      if (profile) apply(canReview(profile.role));
    }).catch(() => {});
  };
  window.addEventListener(accountChanged, updateAccess);
  window.addEventListener(lyssnaInstallReady, updateAccess);
  updateAccess();

  return {
    sync,
    focus() { button.focus({ preventScroll: true }); },
    dispose() {
      request++;
      window.removeEventListener(accountChanged, updateAccess);
      window.removeEventListener(lyssnaInstallReady, updateAccess);
      button.removeEventListener("click", toggle);
      root.unmount();
      button.remove();
    },
  };
}
