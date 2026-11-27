import { ClipboardCheck } from "lucide-react";
import type { Host } from "../host";
import { accountChanged, hasLyssnaSession, readLyssnaProfile } from "../lyssna-account";
import { lyssnaInstallReady } from "../lyssna-api";
import { canReview, reviewQueue } from "./review-api";

const controlsSelector = ".main-globalNav-contentRight, .main-topBar-topbarContentRight";
const actionRowSelector = ".main-actionButtons";
const friendsSelector = '[data-restore-focus-key="buddy_feed"], button[aria-label="Friend Activity" i]';
const bellSelector = `[data-testid="whats-new-feed-button"], button[aria-label="What's New" i], button[aria-label="Notifications" i]`;

export function reviewTopbar(host: Host, toggle: () => void, close: () => void, restore: () => void) {
  const button = document.createElement("button");
  const label = "Review submissions";
  button.type = "button";
  button.className = "lyssna-review-topbar";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", toggle);
  const root = host.mount(button);

  let allowed = false;
  let pressed = false;
  let request = 0;
  let countRequest = 0;
  const renderCount = (count: number) => {
    button.title = count ? `${count > 99 ? "99+" : count} waiting for review` : label;
    button.setAttribute("aria-label", count ? `${label}, ${count > 99 ? "over 99" : count} waiting` : label);
    root.render(<>
      <ClipboardCheck size={20} aria-hidden="true" />
      {count > 0 && <span className="lyssna-review-count" aria-hidden="true">{count > 99 ? "99+" : count}</span>}
    </>);
  };
  renderCount(0);
  const refresh = () => {
    if (!allowed || document.hidden) return;
    const id = ++countRequest;
    void Promise.all([reviewQueue("priority", 100), reviewQueue("backlog", 100)]).then(([priority, backlog]) => {
      if (id === countRequest && allowed) renderCount(priority.length + backlog.length);
    }).catch(() => {});
  };
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
      const firstAccess = next && !allowed;
      allowed = next;
      if (!allowed && pressed) close();
      if (!allowed) {
        countRequest++;
        renderCount(0);
      }
      sync();
      if (firstAccess) restore();
      refresh();
    };
    if (!hasLyssnaSession()) apply(false);
    else void readLyssnaProfile().then((profile) => {
      if (profile) apply(canReview(profile.role));
    }).catch(() => {});
  };
  window.addEventListener(accountChanged, updateAccess);
  window.addEventListener(lyssnaInstallReady, updateAccess);
  const checkVisible = () => { if (!document.hidden) updateAccess(); };
  document.addEventListener("visibilitychange", checkVisible);
  const timer = window.setInterval(checkVisible, 5 * 60_000);
  updateAccess();

  return {
    sync,
    refresh,
    focus() { button.focus({ preventScroll: true }); },
    dispose() {
      request++;
      countRequest++;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkVisible);
      window.removeEventListener(accountChanged, updateAccess);
      window.removeEventListener(lyssnaInstallReady, updateAccess);
      button.removeEventListener("click", toggle);
      root.unmount();
      button.remove();
    },
  };
}
